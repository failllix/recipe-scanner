const { DsqlSigner } = require("@aws-sdk/dsql-signer");
const { Client } = require("pg");

async function getPostgresClient() {
  const clusterEndpoint = process.env.CLUSTER_ENDPOINT;
  const region = process.env.CLUSTER_REGION;

  const signer = new DsqlSigner({
    hostname: clusterEndpoint,
    region,
  });

  const token = await signer.getDbConnectAdminAuthToken();

  const client = new Client({
    host: clusterEndpoint,
    user: "admin",
    password: token,
    database: "postgres",
    port: 5432,
    ssl: {
      rejectUnauthorized: true,
    },
  });

  return client;
}

module.exports = {
  getPostgresClient,
};
