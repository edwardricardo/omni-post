# Multi-Cloud Infrastructure Report

Date: 2026-03-31

## Storage Adapters

| Provider            | Adapter                   | Package               | SDK Version | Status   |
| ------------------- | ------------------------- | --------------------- | ----------- | -------- |
| AWS S3              | S3StorageAdapter          | @aws-sdk/client-s3    | 3.894.0     | Existing |
| Azure Blob          | AzureBlobStorageAdapter   | @azure/storage-blob   | 12.31.0     | NEW      |
| Google Cloud        | GoogleCloudStorageAdapter | @google-cloud/storage | 7.19.0      | NEW      |
| DigitalOcean Spaces | (wraps S3 adapter)        | —                     | —           | NEW      |
| Cloudinary          | CloudinaryStorageAdapter  | cloudinary            | 2.0.0       | Existing |

Switching providers: `STORAGE_PROVIDER` environment variable only. Zero code changes required.

Factory: `apps/api/src/infrastructure/storage/createStorageAdapter.ts`

- s3 (default), do-spaces inline
- azure, gcs as standalone packages

## Deployment Guides

| Cloud        | Guide                                    | Services Documented                           | Estimated Cost |
| ------------ | ---------------------------------------- | --------------------------------------------- | -------------- |
| Local        | docs/deployment/LOCAL.md                 | Docker Compose, MinIO, Mailhog                | Free           |
| AWS          | docs/deployment/AWS.md                   | ECS + RDS + ElastiCache + S3 + CloudFront     | ~$350-470/mo   |
| Azure        | docs/deployment/AZURE.md                 | App Service + PostgreSQL + Redis + Blob + CDN | ~$270-370/mo   |
| GCP          | docs/deployment/GCP.md                   | Cloud Run + Cloud SQL + Memorystore + GCS     | ~$280-400/mo   |
| DigitalOcean | docs/deployment/DIGITALOCEAN.md          | Droplet + Managed DB + Redis + Spaces         | ~$63/mo        |
| Env Vars     | docs/deployment/ENVIRONMENT_VARIABLES.md | Complete reference                            | —              |

## Build and Test

| Check                   | Result                            |
| ----------------------- | --------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks               |
| All tests               | 351 files, 7,159 passed, 0 failed |
| Architecture boundaries | Clean                             |
