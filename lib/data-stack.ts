import path from "path";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";
import * as dsql from "aws-cdk-lib/aws-dsql";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";

export class DataStack extends cdk.Stack {
  uploadBucket: s3.Bucket;
  recipeDataCluster: dsql.CfnCluster;

  constructor(
    scope: Construct,
    id: string,
    { nodePostgresLayer }: { nodePostgresLayer: lambda.LayerVersion },
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    this.uploadBucket = new s3.Bucket(this, "RecipeUploadS3Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.recipeDataCluster = new dsql.CfnCluster(this, "RecipeDataCluster", {
      deletionProtectionEnabled: false,
    });

    const recipeSchemaProviderFunction = new lambda.Function(
      this,
      "RecipeSchemaProviderFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.createRecipeDataSchema",
        code: lambda.Code.fromAsset(path.join(__dirname, "lambda", "schema")),
        layers: [nodePostgresLayer],
        environment: {
          CLUSTER_ENDPOINT: `${this.recipeDataCluster.attrIdentifier}.dsql.${props?.env?.region}.on.aws`,
          CLUSTER_REGION: props?.env?.region || "",
        },
        timeout: cdk.Duration.minutes(5),
      }
    );

    recipeSchemaProviderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dsql:DbConnectAdmin"],
        resources: [this.recipeDataCluster.attrResourceArn],
      })
    );

    const recipeDataSchemaProvider = new cr.Provider(
      this,
      "RecipeDataSchemaProvider",
      {
        onEventHandler: recipeSchemaProviderFunction,
      }
    );

    new cdk.CustomResource(this, "RecipeDataSchemaSetup", {
      serviceToken: recipeDataSchemaProvider.serviceToken,
      properties: { schemaVersion: "0.0.5" },
    });
  }
}
