const { getPostgresClient } = require("dsql-connector");

async function createRecipeDataSchema(event) {
  console.log("Received event:", event);

  const client = await getPostgresClient();

  await client.connect();
  console.log("Successfully opened connection");

  await client.query("DROP TABLE IF EXISTS recipes");
  await client.query("DROP TABLE IF EXISTS textract_jobs");

  await client.query(`CREATE TABLE IF NOT EXISTS recipes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(200) NOT NULL,
      language VARCHAR(80) NOT NULL,
      status VARCHAR(50) NOT NULL
    )`);

  await client.query(`CREATE TABLE IF NOT EXISTS textract_jobs (
      job_id VARCHAR(200) PRIMARY KEY,
      recipe_id UUID NOT NULL,
      file_id VARCHAR(200) NOT NULL,
      status VARCHAR(50) NOT NULL
    )`);

  console.log("Successfully created all tables");
}

module.exports = { createRecipeDataSchema };
