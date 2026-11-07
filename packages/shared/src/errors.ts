export class SecretaryError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'SecretaryError';
  }
}

export class ValidationError extends SecretaryError {
  constructor(message: string, public details?: any) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends SecretaryError {
  constructor(message: string, public resource?: string) {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class IntegrationError extends SecretaryError {
  constructor(message: string, public source?: string, public statusCode?: number) {
    super('INTEGRATION_ERROR', message);
    this.name = 'IntegrationError';
  }
}

export class AgentError extends SecretaryError {
  constructor(message: string) {
    super('AGENT_ERROR', message);
    this.name = 'AgentError';
  }
}

export class ConfigError extends SecretaryError {
  constructor(message: string) {
    super('CONFIG_ERROR', message);
    this.name = 'ConfigError';
  }
}
