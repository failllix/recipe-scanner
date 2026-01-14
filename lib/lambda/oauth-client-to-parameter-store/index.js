const {
  SSMClient,
  PutParameterCommand,
  DeleteParameterCommand,
} = require("@aws-sdk/client-ssm");
const {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const ssmClient = new SSMClient();
const cognitoClient = new CognitoIdentityProviderClient();

async function fetchOAuthClientAndStoreInParameterStore(event) {
  console.log("Event:", JSON.stringify(event, null, 2));
  const props = event.ResourceProperties;

  const physicalResourceId = props.ClientId;

  try {
    switch (event.RequestType) {
      case "Create":
      case "Update":
        await syncSecret(props);
        break;
      case "Delete":
        await deleteSecret(props.ParameterName);
        break;
    }

    return { PhysicalResourceId: physicalResourceId };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

async function syncSecret(props) {
  const describeCmd = new DescribeUserPoolClientCommand({
    UserPoolId: props.UserPoolId,
    ClientId: props.ClientId,
  });

  const cognitoResponse = await cognitoClient.send(describeCmd);
  const secret = cognitoResponse.UserPoolClient.ClientSecret;

  if (!secret) {
    throw new Error(`Client ${props.ClientId} does not have a client secret.`);
  }

  const putCmd = new PutParameterCommand({
    Name: props.ParameterName,
    Value: secret,
    Type: "SecureString",
    Overwrite: true,
  });

  await ssmClient.send(putCmd);
}

async function deleteSecret(parameterName) {
  try {
    const cmd = new DeleteParameterCommand({ Name: parameterName });
    await ssmClient.send(cmd);
  } catch (err) {
    if (err.name !== "ParameterNotFound") throw err;
  }
}

module.exports = { fetchOAuthClientAndStoreInParameterStore };
