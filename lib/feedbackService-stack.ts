import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

interface FeedbackServiceStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
  nlb: elbv2.NetworkLoadBalancer;
  alb: elbv2.ApplicationLoadBalancer;
  repository: ecr.Repository;
  region: string;
}

const APPLICATION_PORT = 3000;

export class FeedbackServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FeedbackServiceStackProps) {
    super(scope, id, props);

    const feedbackDdb = new dynamodb.Table(this, "FeedbackDdb", {
      tableName: "feedbacks",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "Id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        cpu: 1024,
        memoryLimitMiB: 2048,
        family: "feedback-service",
      }
    );

    feedbackDdb.grantReadWriteData(taskDefinition.taskRole);

    taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXrayWriteOnlyAccess")
    );

    const logDriver = ecs.LogDriver.awsLogs({
      logGroup: new logs.LogGroup(this, "LogGroup", {
        logGroupName: "FeedbackService",
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.ONE_MONTH,
      }),
      streamPrefix: "FeedbackService",
    });

    taskDefinition.addContainer("FeedbackServiceContainer", {
      image: ecs.ContainerImage.fromEcrRepository(props.repository, "1.0.0"),
      containerName: "feedbackService",
      logging: logDriver,
      portMappings: [
        {
          containerPort: APPLICATION_PORT,
          protocol: ecs.Protocol.TCP,
        },
      ],
      cpu: 1024,
      memoryLimitMiB: 2048,
      environment: {
        AWS_DYNAMO_TABLE_NAME: feedbackDdb.tableName
      },
    });

    const albListener = props.alb.addListener("FeedbackServiceAlbListener", {
      port: APPLICATION_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: true,
    });

    const service = new ecs.FargateService(this, "FeedbackService", {
      serviceName: "FeedbackService",
      cluster: props.cluster,
      taskDefinition: taskDefinition,
      desiredCount: 2,
      minHealthyPercent: 50,
    });
    props.repository.grantPull(taskDefinition.taskRole);

    service.connections.securityGroups[0].addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(APPLICATION_PORT),
      "Allow NLB traffic"
    );

    albListener.addTargets("FeedbackServiceAlbTarget", {
      targetGroupName: "FeedbackServiceAlb",
      port: APPLICATION_PORT,
      targets: [service],
      protocol: elbv2.ApplicationProtocol.HTTP,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        interval: cdk.Duration.seconds(30),
        enabled: true,
        port: `${APPLICATION_PORT}`,
        timeout: cdk.Duration.seconds(10),
        path: "/health",
      },
    });

    const nlbListener = props.nlb.addListener("FeedbackServiceNlbListener", {
      port: APPLICATION_PORT,
      protocol: elbv2.Protocol.TCP,
    });

    nlbListener.addTargets("FeedbackServiceNlbTarget", {
      port: APPLICATION_PORT,
      targetGroupName: "FeedbackServiceNlb",
      protocol: elbv2.Protocol.TCP,
      targets: [
        service.loadBalancerTarget({
          containerName: "feedbackService",
          containerPort: APPLICATION_PORT,
          protocol: ecs.Protocol.TCP,
        }),
      ],
    });

    const scalableTaskCount = service.autoScaleTaskCount({
      maxCapacity: 4,
      minCapacity: 2,
    });

    scalableTaskCount.scaleOnCpuUtilization("FeedbackServiceAutoScaling", {
      targetUtilizationPercent: 10,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
  }
}
