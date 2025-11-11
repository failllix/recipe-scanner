import path from "path";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as lambda from "aws-cdk-lib/aws-lambda";

export class LambdaLayerStack extends cdk.Stack {
  nodePostgresLayer: lambda.LayerVersion;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.nodePostgresLayer = new lambda.LayerVersion(
      this,
      "NodePostgresLayer",
      {
        code: lambda.Code.fromAsset(
          path.join(__dirname, "layer", "node-postgres"),
          {
            bundling: {
              image: lambda.Runtime.NODEJS_22_X.bundlingImage,
              environment: {
                npm_config_cache: "/tmp/npm_cache",
              },
              command: [
                "bash",
                "-c",
                "mkdir -p /asset-output/nodejs && cp package.json /asset-output/nodejs && cp package-lock.json /asset-output/nodejs && npm ci --prefix /asset-output/nodejs && cp -R dsql-connector /asset-output/nodejs/node_modules",
              ],
            },
          }
        ),
        compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      }
    );
  }
}
