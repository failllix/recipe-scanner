#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { TextExtractionStack } from "../lib/text-extraction-stack";
import { AuthStack } from "../lib/auth-stack";

const app = new cdk.App();

const authStack = new AuthStack(app, "RecipeScannerAuthStack", {
  env: { account: "354552664184", region: "eu-central-1" },
});

new TextExtractionStack(
  app,
  "RecipeScannerStack",
  { httpApi: authStack.httpApi },
  {
    env: { account: "354552664184", region: "eu-central-1" },
  }
);
