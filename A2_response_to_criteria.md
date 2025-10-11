Assignment 2 - Cloud Services Exercises - Response to Criteria
================================================

Instructions
------------------------------------------------
- Keep this file named A2_response_to_criteria.md, do not change the name
- Upload this file along with your code in the root directory of your project
- Upload this file in the current Markdown format (.md extension)
- Do not delete or rearrange sections.  If you did not attempt a criterion, leave it blank
- Text inside [ ] like [eg. S3 ] are examples and should be removed


Overview
------------------------------------------------

- **Name:** Karan Singh Sandhu
- **Student number:** n11845619
- **Partner name (if applicable):** Ayesha Yasin
- **Partner Student number (if applicable):** n11841486
- **Application name:** NoteFlix
- **Two line description:** A stateless cloud application(Documents to Podcast type videos) that allows users to upload and manage files, with metadata stored in DynamoDB, authentication via Cognito, caching with Redis, and secure configuration via Parameter Store and Secrets Manager.
- **EC2 instance name or ID:** i-0af58eedf22a154b0  

------------------------------------------------

### Core - First data persistence service

- **AWS service name:** S3
- **What data is being stored?:** Uploaded files
- **Why is this service suited to this data?:** S3 is durable, scalable, and designed for storing large binary objects.
- **Why is are the other services used not suitable for this data?:** DynamoDB and Redis are not suited for binary object storage.
- **Bucket/instance/table name:** n11845619-assignment2
- **Video timestamp:** 00:25-00:47
- **Relevant files:**
    - backend/src/routes/assets.js
    - backend/src/routes/jobs.js

### Core - Second data persistence service

- **AWS service name:** DynamoDB
- **What data is being stored?:** File metadata (filename, user ID, timestamp, S3 reference)
- **Why is this service suited to this data?:** DynamoDB provides fast, scalable access to structured metadata with indexing support.
- **Why is are the other services used not suitable for this data?:** S3 cannot query metadata fields efficiently, Redis is not persistent.
- **Bucket/instance/table name:** n11845619-noteflix
- **Video timestamp:** 00:32-01:00
- **Relevant files:**
    - backend/src/routes/assets.js
    - backend/src/routes/jobs.js
    - backend/src/ddb.js


### S3 Pre-signed URLs

- **S3 Bucket names:** n11845619-assignment2
- **Video timestamp:** 04:27-05:21
- **Relevant files:**
    - backend/src/routes/assets.js
    - backend/src/routes/jobs.js

### In-memory cache

- **ElastiCache instance name:** redis
- **What data is being cached?:** File metadata lookups
- **Why is this data likely to be accessed frequently?:** Popular files and recent uploads are requested multiple times across sessions.
- **Video timestamp:** 01:00- 01:50
- **Relevant files:**
    - backend/src/lib/cache.js

### Core - Statelessness

- **What data is stored within your application that is not stored in cloud data services?:** Temporary in-memory variables like file buffers during upload.
- **Why is this data not considered persistent state?:** These are transient and can be recreated from the persisted S3/DynamoDB data.
- **How does your application ensure data consistency if the app suddenly stops?:** All persistent state is in cloud services, so the app can recover by reloading from S3 and DynamoDB.
- **Relevant files:**
    - backend/src/*

### Graceful handling of persistent connections

- **Type of persistent connection and use:**
- **Method for handling lost connections:**
- **Relevant files:**

### Core - Authentication with Cognito

- **User pool name:** n11845619-assignment2
- **How are authentication tokens handled by the client?:** ID tokens are stored in an HTTP-only cookie (`nf_id`) for session handling.
- **Video timestamp:** 01:51-02:33
- **Relevant files:**
    - backend/src/middleware/auth.js
    - backend/src/auth.js
    - frotend/src/hooks/useAuth.js
    - frotend/src/app/login/page.tsx

### Cognito multi-factor authentication

- **What factors are used for authentication:** Password + TOTP code
- **Video timestamp:** 02:07-02:52
- **Relevant files:**
    - frotend/src/hooks/useAuth.js
    - frotend/src/app/login/page.tsx


### Cognito federated identities

- **Identity providers used:** Google
- **Video timestamp:** 02:57-03:25
- **Relevant files:**
    - frotend/src/app/api/*
    - backend/src/lib/oauth.js

### Cognito groups

- **How are groups used to set permissions?:** Users in the `admin` group can perform admin-only actions such as file deletion; normal users cannot.
- **Video timestamp:** 03:26-04:26
- **Relevant files:**
     - backend/src/middleware/auth.js

### Core - DNS with Route53

- **Subdomain**: http://noteflix.cab432.com/
- **Video timestamp:** 06:04-06:23

### Parameter store

- **Parameter names:** /n11845619/noteflix/prod/*
- **Video timestamp:** 05:23-05:40
- **Relevant files:**
    - backend/src/lib/config.js

### Secrets manager

- **Secrets names:** /n11845619/noteflix/prod/wiki
- **Video timestamp:** 05:40-06:02
- **Relevant files:**
    - backend/src/lib/wikiauth.js

### Infrastructure as code

- **Technology used:** Docker Compose
- **Services deployed:** Backend API, Frontend client, Redis cache, Nginx reverse proxy
- **Relevant files:**
    - docker-compose.yml

### Other (with prior approval only)

- **Description:**
- **Video timestamp:**
- **Relevant files:**
    -

### Other (with prior permission only)

- **Description:**
- **Video timestamp:**
- **Relevant files:**
    -
