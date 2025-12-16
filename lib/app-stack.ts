import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deployment from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import path from "path";
import { spawnSync } from "child_process";

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const frontendBucket = new s3.Bucket(this, "RecipeScannerFrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    new s3Deployment.BucketDeployment(this, "RecipeScannerFrontendDeployment", {
      sources: [
        s3Deployment.Source.asset(path.join(__dirname, "../app"), {
          bundling: {
            image: cdk.DockerImage.fromRegistry(
              "public.ecr.aws/docker/library/node:lts"
            ),
            local: {
              tryBundle(outputDir) {
                try {
                  spawnSync("npm --version");
                } catch {
                  return false;
                }
                spawnSync(
                  [
                    "cd app",
                    "npm ci",
                    `npm run build -- -c production --output-path ${outputDir}`,
                  ].join(" && "),
                  {
                    shell: true,
                    stdio: "inherit",
                  }
                );
                return true;
              },
            },
          },
        }),
      ],
      destinationBucket: frontendBucket,
    });

    const frontendDistribution = new cloudfront.Distribution(
      this,
      "RecipeScannerDistribution",
      {
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        defaultRootObject: "index.html",
        defaultBehavior: {
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
            frontendBucket,
            {
              originPath: "/browser",
            }
          ),
        },
      }
    );

    new cdk.CfnOutput(this, "WebAppDomainName", {
      value: frontendDistribution.distributionDomainName,
    });
  }
}
