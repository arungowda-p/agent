# Information Security Policy

Northwind encrypts all customer data at rest using AES-256 and in transit using TLS 1.2 or higher.
Encryption keys are managed in AWS KMS and rotated every 365 days.

# Compliance

Northwind completed a SOC 2 Type II audit in March 2025 covering security, availability and confidentiality.
The report is available to customers under NDA. Northwind is GDPR compliant and offers a Data Processing Addendum.

# Access Control

Multi-factor authentication is enforced for all employees and contractors on every production system.
Production access follows the principle of least privilege and is reviewed quarterly by the security team.
Access is revoked within 24 hours of an employee leaving the company.

# Incident Response

Northwind maintains a documented incident response plan that is tested annually through tabletop exercises.
Customers are notified of confirmed security incidents affecting their data within 72 hours.

# Business Continuity

Backups are taken daily, encrypted, and stored in a separate AWS region. Restores are tested quarterly.
The recovery time objective (RTO) is 4 hours and the recovery point objective (RPO) is 24 hours.
