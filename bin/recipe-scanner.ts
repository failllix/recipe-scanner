#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { TextExtractionStack } from "../lib/text-extraction-stack";
import { AuthStack } from "../lib/auth-stack";
import { DataStack } from "../lib/data-stack";
import { LambdaLayerStack } from "../lib/lambda-layer-stack";
import { AppStack } from "../lib/app-stack";

const app = new cdk.App();

const lambdaLayerStack = new LambdaLayerStack(
  app,
  "RecipeScannerLambdaLayerStack",
  { env: { account: "354552664184", region: "eu-central-1" } }
);

const dataStack = new DataStack(
  app,
  "RecipeScannerDataStack",
  { nodePostgresLayer: lambdaLayerStack.nodePostgresLayer },
  {
    env: { account: "354552664184", region: "eu-central-1" },
  }
);

const authStack = new AuthStack(app, "RecipeScannerAuthStack", {
  env: { account: "354552664184", region: "eu-central-1" },
});

new TextExtractionStack(
  app,
  "RecipeScannerTextExtractionStack",
  {
    httpApi: authStack.httpApi,
    uploadBucket: dataStack.uploadBucket,
    recipeDataCluster: dataStack.recipeDataCluster,
    nodePostgresLayer: lambdaLayerStack.nodePostgresLayer,
  },
  {
    env: { account: "354552664184", region: "eu-central-1" },
  }
);

new AppStack(app, "RecipeScannerAppStack", {
  env: { account: "354552664184", region: "eu-central-1" },
});
