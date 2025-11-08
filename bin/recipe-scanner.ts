#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { RecipeScannerStack } from "../lib/recipe-scanner-stack";
import { AuthStack } from "../lib/auth-stack";

const app = new cdk.App();

const authStack = new AuthStack(app, "RecipeScannerAuthStack", {
  env: { account: "354552664184", region: "eu-central-1" },
});

new RecipeScannerStack(
  app,
  "RecipeScannerStack",
  { userPool: authStack.userPool, userPoolClient: authStack.userPoolClient },
  {
    env: { account: "354552664184", region: "eu-central-1" },
  }
);
