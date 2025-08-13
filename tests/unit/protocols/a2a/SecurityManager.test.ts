// tests/unit/protocols/a2a/SecurityManager.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SecurityManager, SecurityCredentials } from '../../../../protocols/src/a2a/SecurityManager';
import {
  SecurityScheme,
  APIKeySecurityScheme,
  HTTPAuthSecurityScheme,
  OAuth2SecurityScheme,
  OpenIdConnectSecurityScheme,
  MutualTLSSecurityScheme,
  ClientCredentialsAuthFlow,
  AuthorizationCodeAuthFlow
} from '../../../../protocols/src/a2a/types';
import axios from 'axios';
import jwt from 'jsonwebtoken';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SecurityManager', () => {
  let securityManager: SecurityManager;
  let securitySchemes: SecurityScheme[];

  beforeEach(() => {
    securitySchemes = [];
    securityManager = new SecurityManager(securitySchemes);
    jest.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with security schemes', () => {
      const schemes: SecurityScheme[] = [
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        } as APIKeySecurityScheme,
        {
          type: 'http',
          scheme: 'bearer'
        } as HTTPAuthSecurityScheme
      ];

      const manager = new SecurityManager(schemes);
      const registeredSchemes = manager.getSecuritySchemes();

      expect(registeredSchemes).toHaveLength(2);
      expect(registeredSchemes[0].type).toBe('apiKey');
      expect(registeredSchemes[1].type).toBe('http');
    });

    it('should handle empty schemes array', () => {
      const manager = new SecurityManager([]);
      const schemes = manager.getSecuritySchemes();

      expect(schemes).toHaveLength(0);
    });
  });

  describe('API Key Authentication', () => {
    it('should generate API key headers correctly', async () => {
      const scheme: APIKeySecurityScheme = {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        apiKey: 'test-api-key-123'
      };

      const headers = await securityManager.getAuthHeaders('apiKey', credentials);

      expect(headers).toHaveProperty('X-API-Key');
      expect(headers['X-API-Key']).toBe('test-api-key-123');
    });

    it('should handle API key in cookie', async () => {
      const scheme: APIKeySecurityScheme = {
        type: 'apiKey',
        in: 'cookie',
        name: 'auth_token'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        apiKey: 'cookie-value-456'
      };

      const headers = await securityManager.getAuthHeaders('apiKey', credentials);

      expect(headers).toHaveProperty('Cookie');
      expect(headers['Cookie']).toBe('auth_token=cookie-value-456');
    });

    it('should throw error when API key not provided', async () => {
      const scheme: APIKeySecurityScheme = {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {};

      await expect(
          securityManager.getAuthHeaders('apiKey', credentials)
      ).rejects.toThrow('API key not provided');
    });

    it('should return empty headers for query params', async () => {
      const scheme: APIKeySecurityScheme = {
        type: 'apiKey',
        in: 'query',
        name: 'api_key'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        apiKey: 'query-key-789'
      };

      const headers = await securityManager.getAuthHeaders('apiKey', credentials);

      // Query params are handled elsewhere, not in headers
      expect(headers).toEqual({});
    });
  });

  describe('HTTP Authentication', () => {
    it('should generate Bearer token headers', async () => {
      const scheme: HTTPAuthSecurityScheme = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        bearerToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      };

      const headers = await securityManager.getAuthHeaders('http', credentials);

      expect(headers).toHaveProperty('Authorization');
      expect(headers['Authorization']).toMatch(/^Bearer /);
    });

    it('should generate Basic auth headers', async () => {
      const scheme: HTTPAuthSecurityScheme = {
        type: 'http',
        scheme: 'basic'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        apiKey: 'username:password' // Basic auth expects username:password
      };

      const headers = await securityManager.getAuthHeaders('http', credentials);

      expect(headers).toHaveProperty('Authorization');
      expect(headers['Authorization']).toMatch(/^Basic /);

      // Verify base64 encoding
      const encoded = Buffer.from('username:password').toString('base64');
      expect(headers['Authorization']).toBe(`Basic ${encoded}`);
    });

    it('should throw error for unsupported HTTP scheme', async () => {
      const scheme: HTTPAuthSecurityScheme = {
        type: 'http',
        scheme: 'digest' // Not supported
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        bearerToken: 'some-token'
      };

      await expect(
          securityManager.getAuthHeaders('http', credentials)
      ).rejects.toThrow('Unsupported HTTP auth scheme: digest');
    });
  });

  describe('OAuth2 Authentication', () => {
    it('should handle client credentials flow', async () => {
      const scheme: OAuth2SecurityScheme = {
        type: 'oauth2',
        flows: {
          ClientCredentials: {
            tokenUrl: 'https://auth.example.com/token',
            scopes: { 'read': 'Read access', 'write': 'Write access' }
          }
        }
      };

      securityManager = new SecurityManager([scheme]);

      // Mock axios response
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'new-access-token-123' }
      });

      const credentials: SecurityCredentials = {
        oauth2: {
          clientId: 'client-123',
          clientSecret: 'secret-456'
        }
      };

      const headers = await securityManager.getAuthHeaders('oauth2', credentials);

      expect(headers).toHaveProperty('Authorization');
      expect(headers['Authorization']).toBe('Bearer new-access-token-123');
      expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://auth.example.com/token',
          expect.objectContaining({
            grant_type: 'client_credentials',
            client_id: 'client-123',
            client_secret: 'secret-456'
          }),
          expect.any(Object)
      );
    });

    it('should use cached OAuth2 token when valid', async () => {
      const scheme: OAuth2SecurityScheme = {
        type: 'oauth2',
        flows: {
          ClientCredentials: {
            tokenUrl: 'https://auth.example.com/token',
            scopes: {}
          }
        }
      };

      securityManager = new SecurityManager([scheme]);

      // First call - should fetch token
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'cached-token-abc' }
      });

      const credentials: SecurityCredentials = {
        oauth2: {
          clientId: 'client-cache',
          clientSecret: 'secret-cache'
        }
      };

      await securityManager.getAuthHeaders('oauth2', credentials);

      // Second call - should use cache
      const headers2 = await securityManager.getAuthHeaders('oauth2', credentials);

      expect(headers2['Authorization']).toBe('Bearer cached-token-abc');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should refresh OAuth2 token using refresh token', async () => {
      const scheme: OAuth2SecurityScheme = {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            refreshUrl: 'https://auth.example.com/refresh',
            scopes: { 'api': 'API access' }
          }
        }
      };

      securityManager = new SecurityManager([scheme]);

      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'refreshed-token-xyz' }
      });

      const credentials: SecurityCredentials = {
        oauth2: {
          clientId: 'client-refresh',
          clientSecret: 'secret-refresh',
          refreshToken: 'refresh-token-123'
        }
      };

      const headers = await securityManager.getAuthHeaders('oauth2', credentials);

      expect(headers['Authorization']).toBe('Bearer refreshed-token-xyz');
      expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://auth.example.com/refresh',
          expect.objectContaining({
            grant_type: 'refresh_token',
            refresh_token: 'refresh-token-123'
          }),
          expect.any(Object)
      );
    });

    it('should use existing access token if available', async () => {
      const scheme: OAuth2SecurityScheme = {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: {}
          }
        }
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        oauth2: {
          clientId: 'client-existing',
          clientSecret: 'secret-existing',
          accessToken: 'existing-token-999'
        }
      };

      const headers = await securityManager.getAuthHeaders('oauth2', credentials);

      expect(headers['Authorization']).toBe('Bearer existing-token-999');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('OpenID Connect', () => {
    it('should handle OIDC authentication', async () => {
      const scheme: OpenIdConnectSecurityScheme = {
        type: 'openIdConnect',
        openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        oidc: {
          idToken: 'id-token-123',
          accessToken: 'access-token-456'
        }
      };

      const headers = await securityManager.getAuthHeaders('openIdConnect', credentials);

      expect(headers).toHaveProperty('Authorization');
      expect(headers['Authorization']).toBe('Bearer access-token-456');
    });

    it('should throw error when OIDC credentials not provided', async () => {
      const scheme: OpenIdConnectSecurityScheme = {
        type: 'openIdConnect',
        openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {};

      await expect(
          securityManager.getAuthHeaders('openIdConnect', credentials)
      ).rejects.toThrow('OIDC credentials not provided');
    });
  });

  describe('Mutual TLS', () => {
    it('should return empty headers for mTLS', async () => {
      const scheme: MutualTLSSecurityScheme = {
        type: 'mutualTLS'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        mtls: {
          clientCert: 'cert-content',
          clientKey: 'key-content'
        }
      };

      // mTLS is handled at connection level, not headers
      const headers = await securityManager.getAuthHeaders('mutualTLS', credentials);

      expect(headers).toEqual({});
    });

    it('should provide TLS config', async () => {
      const scheme: MutualTLSSecurityScheme = {
        type: 'mutualTLS'
      };

      securityManager = new SecurityManager([scheme]);

      const credentials: SecurityCredentials = {
        mtls: {
          clientCert: 'cert-content',
          clientKey: 'key-content',
          caCert: 'ca-cert-content'
        }
      };

      const tlsConfig = await securityManager.getTLSConfig('mutualTLS', credentials);

      expect(tlsConfig).toHaveProperty('cert', 'cert-content');
      expect(tlsConfig).toHaveProperty('key', 'key-content');
      expect(tlsConfig).toHaveProperty('ca', 'ca-cert-content');
      expect(tlsConfig).toHaveProperty('rejectUnauthorized', true);
    });

    it('should throw error when mTLS credentials not provided', async () => {
      const scheme: MutualTLSSecurityScheme = {
        type: 'mutualTLS'
      };

      securityManager = new SecurityManager([scheme]);

      await expect(
          securityManager.getTLSConfig('mutualTLS', {})
      ).rejects.toThrow('mTLS credentials not provided');
    });
  });

  describe('PKCE Support', () => {
    it('should generate PKCE challenge', () => {
      const { verifier, challenge } = securityManager.generatePKCEChallenge();

      expect(verifier).toBeDefined();
      expect(challenge).toBeDefined();
      expect(verifier).not.toBe(challenge);
      expect(verifier.length).toBeGreaterThan(0);
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('should generate different challenges each time', () => {
      const challenge1 = securityManager.generatePKCEChallenge();
      const challenge2 = securityManager.generatePKCEChallenge();

      expect(challenge1.verifier).not.toBe(challenge2.verifier);
      expect(challenge1.challenge).not.toBe(challenge2.challenge);
    });
  });

  describe('JWT Validation', () => {
    it('should validate JWT token', () => {
      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 3600 };
      const secret = 'test-secret';
      const token = jwt.sign(payload, secret);

      const decoded = securityManager.validateJWT(token, secret);

      expect(decoded.sub).toBe('user123');
      expect(decoded.exp).toBeDefined();
    });

    it('should throw error for invalid JWT', () => {
      const token = 'invalid-jwt-token';
      const secret = 'test-secret';

      expect(() => {
        securityManager.validateJWT(token, secret);
      }).toThrow('JWT validation failed');
    });

    it('should throw error for expired JWT', () => {
      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) - 3600 };
      const secret = 'test-secret';
      const token = jwt.sign(payload, secret);

      expect(() => {
        securityManager.validateJWT(token, secret);
      }).toThrow('JWT validation failed');
    });
  });

  describe('Error Handling', () => {
    it('should handle none security scheme', async () => {
      const headers = await securityManager.getAuthHeaders('none');
      expect(headers).toEqual({});
    });

    it('should handle missing credentials gracefully', async () => {
      const headers = await securityManager.getAuthHeaders('any-scheme');
      expect(headers).toEqual({});
    });

    it('should throw error for unknown security scheme', async () => {
      const scheme: APIKeySecurityScheme = {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      };

      securityManager = new SecurityManager([scheme]);

      await expect(
          securityManager.getAuthHeaders('unknown-scheme', { apiKey: 'test' })
      ).rejects.toThrow('Security scheme not found: unknown-scheme');
    });

    it('should handle OAuth2 token request failure', async () => {
      const scheme: OAuth2SecurityScheme = {
        type: 'oauth2',
        flows: {
          ClientCredentials: {
            tokenUrl: 'https://auth.example.com/token',
            scopes: {}
          }
        }
      };

      securityManager = new SecurityManager([scheme]);

      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      const credentials: SecurityCredentials = {
        oauth2: {
          clientId: 'client-fail',
          clientSecret: 'secret-fail'
        }
      };

      await expect(
          securityManager.getAuthHeaders('oauth2', credentials)
      ).rejects.toThrow('OAuth2 token request failed');
    });
  });

  describe('Get Security Schemes', () => {
    it('should return all registered security schemes', () => {
      const schemes: SecurityScheme[] = [
        { type: 'apiKey', in: 'header', name: 'X-API-Key' } as APIKeySecurityScheme,
        { type: 'http', scheme: 'bearer' } as HTTPAuthSecurityScheme,
        { type: 'oauth2', flows: {} } as OAuth2SecurityScheme
      ];

      securityManager = new SecurityManager(schemes);
      const registered = securityManager.getSecuritySchemes();

      expect(registered).toHaveLength(3);
      expect(registered.map(s => s.type)).toEqual(['apiKey', 'http', 'oauth2']);
    });
  });
});