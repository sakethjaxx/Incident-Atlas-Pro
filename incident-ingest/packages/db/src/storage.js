import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

// Create client
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  region: process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET_NAME || "uploads";

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    }
  }
}

let bucketEnsured = false;

export async function uploadToStorage(key, body, contentType) {
  if (!bucketEnsured) {
    await ensureBucket();
    bucketEnsured = true;
  }
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function readFromStorage(key) {
  const data = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
  return data.Body.transformToString();
}
