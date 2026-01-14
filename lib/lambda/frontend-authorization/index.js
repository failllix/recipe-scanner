const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");
const { CognitoJwtVerifier } = require("aws-jwt-verify");

let configuration;

async function getConfiguration() {
  if (configuration != undefined) {
    return configuration;
  }

  const client = new SSMClient();
  const response = await client.send(
    new GetParametersCommand({
      Names: [
        "RecipeScannerFrontendRedirectUri",
        "RecipeScannerFrontendClientId",
        "RecipeScannerFrontendAuthorizationBaseUrl",
        "RecipeScannerUserPoolId",
      ],
      WithDecryption: false,
    })
  );

  const parameters = response.Parameters ?? [];

  configuration = {
    CLIENT_ID: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendClientId";
    }).Value,
    REDIRECT_URI: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendRedirectUri";
    }).Value,
    AUTHORIZATION_BASE_URL: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendAuthorizationBaseUrl";
    }).Value,
    USER_POOL_ID: parameters.find((curr) => {
      return curr.Name == "RecipeScannerUserPoolId";
    }).Value,
  };

  const verifier = CognitoJwtVerifier.create({
    userPoolId: configuration.USER_POOL_ID,
    tokenUse: "access",
    clientId: configuration.CLIENT_ID,
  });

  configuration.verifier = verifier;

  return configuration;
}

async function authorizeFrontendAccess(event) {
  const request = event.Records[0].cf.request;

  const requestedUri = request.uri;
  const cookies = request.headers.cookie?.[0].value ?? "";

  const cookiesMap =
    cookies != ""
      ? cookies.split("; ").reduce((acc, curr) => {
          const parts = curr.split("=");
          acc[parts[0]] = parts[1];
          return acc;
        }, {})
      : {};

  const { CLIENT_ID, REDIRECT_URI, AUTHORIZATION_BASE_URL, verifier } =
    await getConfiguration();

  try {
    if (cookiesMap.accessToken == undefined) {
      throw new Error("Missing token");
    }

    const accessToken = cookiesMap.accessToken;

    await verifier.verify(accessToken);
    return request;
  } catch (error) {
    console.log("Token not valid!", error);

    const state = {
      requestedUri,
    };

    const queryParams = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: btoa(JSON.stringify(state)),
    });
    return {
      status: 307,
      headers: {
        location: [
          {
            key: "Location",
            value: `${AUTHORIZATION_BASE_URL}/oauth2/authorize?${queryParams.toString()}`,
          },
        ],
      },
    };
  }
}

module.exports = { authorizeFrontendAccess };
