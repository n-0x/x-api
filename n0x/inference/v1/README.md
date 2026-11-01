`GatewayAdminService` is the internal Connect administration contract for
inference keys, usage and routes. The inference process mounts it under `/api/`
behind `association.PrivateInterceptor`; the manager authorizes the human and
account before calling. Virtual-key Bearer authentication does not authorize
administration. Only `IssueKeyResponse.secret` returns the secret, once.
