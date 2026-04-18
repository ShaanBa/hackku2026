import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
};

if (!uri) {
  throw new Error(
    'Invalid/Missing environment variable: "MONGODB_URI"'
  );
}

let clientPromise;

if (process.env.NODE_ENV === "development") {
  const globalWithMongo = globalThis;

  if (!globalWithMongo._mongoClientPromise) {
    const client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }

  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  const client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export { clientPromise };

export async function getDb() {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "app";
  return client.db(dbName);
}
