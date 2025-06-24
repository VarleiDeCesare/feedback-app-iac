#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EcrStack } from "../lib/ecr-stack";
import { VpcStack } from "../lib/vpc-stack";
import { LoadBalancerStack } from "../lib/lb-stack";
import { ClusterStack } from "../lib/cluster-stack";
import { FeedbackServiceStack } from "../lib/feedbackService-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: "499604939475",
  region: "us-east-1",
};

const tagsInfra = {
  cost: "FeedbackAppInfra",
  team: "varlei-team",
};

const ecrStack = new EcrStack(app, "Ecr", {
  env: env,
  tags: tagsInfra,
});

const vpcStack = new VpcStack(app, "Vpc", {
  env: env,
  tags: tagsInfra,
});

const lbStack = new LoadBalancerStack(app, "LoadBalancer", {
  vpc: vpcStack.vpc,
  env,
  tags: tagsInfra,
});
lbStack.addDependency(vpcStack);

const clusterStack = new ClusterStack(app, "Cluster", {
  vpc: vpcStack.vpc,
  env: env,
  tags: tagsInfra,
});
clusterStack.addDependency(vpcStack);

const tagsFeedbackApplication = {
  cost: "FeedbackApp",
  team: "varlei-team",
};

const feedbackApp = new FeedbackServiceStack(app, "FeedbackApp", {
  vpc: vpcStack.vpc,
  cluster: clusterStack.cluster,
  env,
  nlb: lbStack.nlb,
  alb: lbStack.alb,
  repository: ecrStack.repository,
  region: lbStack.region,
  tags: tagsFeedbackApplication,
});

feedbackApp.addDependency(lbStack);
feedbackApp.addDependency(clusterStack);
feedbackApp.addDependency(vpcStack);
feedbackApp.addDependency(ecrStack);