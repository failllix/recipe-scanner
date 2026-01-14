import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3Deployment from "aws-cdk-lib/aws-s3-deployment";
import * as systemsManager from "aws-cdk-lib/aws-ssm";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import path from "path";
import { spawnSync } from "child_process";
import { OauthClientParameterStoreSecret } from "./constructs/oauth-client-parameter-store-secret";

export class AppStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    {
      userPool,
      userPoolDomain,
    }: { userPool: cognito.UserPool; userPoolDomain: cognito.UserPoolDomain },
    props?: cdk.StackProps
  ) {
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

    const frontendAuthorizerFunction = new cloudfront.experimental.EdgeFunction(
      this,
      "RecipeScannerFrontendAuthorizer",
      {
        runtime: lambda.Runtime.NODEJS_LATEST,
        code: lambda.Code.fromCustomCommand(
          path.join(__dirname, "lambda", "frontend-authorization", "dist"),
          ["npm", "run", "build"],
          {
            commandOptions: {
              cwd: path.join(__dirname, "lambda", "frontend-authorization"),
            },
          }
        ),
        handler: "bundle.authorizeFrontendAccess",
      }
    );

    const frontendLoginFunction = new cloudfront.experimental.EdgeFunction(
      this,
      "RecipeScannerFrontendLogin",
      {
        runtime: lambda.Runtime.NODEJS_LATEST,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda", "frontend-login")
        ),
        handler: "index.handleFrontendLogin",
      }
    );

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
          edgeLambdas: [
            {
              functionVersion: frontendAuthorizerFunction.currentVersion,
              eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
              includeBody: false,
            },
          ],
        },
        additionalBehaviors: {
          "/login": {
            origin: new cloudfrontOrigins.HttpOrigin("amazon.com"), // This origin should never be requested! Response will be provided by associated edge lambda. Typescript forced me to put some origin here...,
            edgeLambdas: [
              {
                eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
                functionVersion: frontendLoginFunction.currentVersion,
                includeBody: false,
              },
            ],
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          },
        },
      }
    );

    const redirectUri =
      "https://" + frontendDistribution.distributionDomainName + "/login";

    const frontendClient = new cognito.UserPoolClient(this, "frontend-client", {
      userPool: userPool,
      generateSecret: true,
      oAuth: {
        callbackUrls: [redirectUri],
      },
    });

    new cognito.CfnManagedLoginBranding(
      this,
      "TestClientManagedLoginBranding",
      {
        userPoolId: userPool.userPoolId,
        clientId: frontendClient.userPoolClientId,
        returnMergedResources: true,
        useCognitoProvidedValues: true,
      }
    );

    const frontendRedirectUriParamter = new systemsManager.StringParameter(
      this,
      "RecipeScannerFrontendRedirectUri",
      {
        description:
          "Redirect URI for the recipe scanner frontend after logging in at the cognito user pool.",
        parameterName: "RecipeScannerFrontendRedirectUri",
        stringValue: redirectUri,
        tier: systemsManager.ParameterTier.STANDARD,
      }
    );

    const frontendClientIdParameter = new systemsManager.StringParameter(
      this,
      "RecipeScannerFrontendClientId",
      {
        description:
          "Redirect URI for the recipe scanner frontend after logging in at the cognito user pool.",
        parameterName: "RecipeScannerFrontendClientId",
        stringValue: frontendClient.userPoolClientId,
        tier: systemsManager.ParameterTier.STANDARD,
      }
    );

    const frontendClientSecretParameter = new OauthClientParameterStoreSecret(
      this,
      "RecipeScannerFrontendClientSecret",
      {
        userPool: userPool,
        userPoolClient: frontendClient,
        parameterName: "RecipeScannerFrontendClientSecret",
      }
    );

    const frontendAuthorizationBaseUrlParameter =
      new systemsManager.StringParameter(
        this,
        "RecipeScannerFrontendAuthorizationBaseUrl",
        {
          description:
            "Redirect URI for the recipe scanner frontend after logging in at the cognito user pool.",
          parameterName: "RecipeScannerFrontendAuthorizationBaseUrl",
          stringValue: userPoolDomain.baseUrl(),
          tier: systemsManager.ParameterTier.STANDARD,
        }
      );

    const frontendUserPoolIdParameter = new systemsManager.StringParameter(
      this,
      "RecipeScannerUserPoolId",
      {
        description: "in at the cognito user pool.",
        parameterName: "RecipeScannerUserPoolId",
        stringValue: userPool.userPoolId,
        tier: systemsManager.ParameterTier.STANDARD,
      }
    );

    frontendRedirectUriParamter.grantRead(frontendAuthorizerFunction);
    frontendClientIdParameter.grantRead(frontendAuthorizerFunction);
    frontendAuthorizationBaseUrlParameter.grantRead(frontendAuthorizerFunction);
    frontendUserPoolIdParameter.grantRead(frontendAuthorizerFunction);

    frontendClientIdParameter.grantRead(frontendLoginFunction);
    frontendClientSecretParameter.grantRead(frontendLoginFunction);
    frontendRedirectUriParamter.grantRead(frontendLoginFunction);
    frontendAuthorizationBaseUrlParameter.grantRead(frontendLoginFunction);

    new cdk.CfnOutput(this, "WebAppDomainName", {
      value: frontendDistribution.distributionDomainName,
    });
  }
}
