// packages/protocols/src/a2a/SecurityManager.ts
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import {
    SecurityScheme,
    APIKeySecurityScheme,
    HTTPAuthSecurityScheme,
    OAuth2SecurityScheme,
    OpenIdConnectSecurityScheme,
    MutualTLSSecurityScheme,
    AuthorizationCodeAuthFlow,
    ClientCredentialsAuthFlow
} from './types';

export interface SecurityCredentials {
    apiKey?: string;
    bearerToken?: string;
    oauth2?: {
        clientId: string;
        clientSecret: string;
        accessToken?: string;
        refreshToken?: string;
        tokenExpiry?: Date;
    };
    oidc?: {
        idToken: string;
        accessToken: string;
    };
    mtls?: {
        clientCert: string;
        clientKey: string;
        caCert?: string;
    };
}

export class SecurityManager {
    private schemes: Map<string, SecurityScheme> = new Map();
    private tokenCache: Map<string, { token: string; expiry: Date }> = new Map();

    constructor(securitySchemes: SecurityScheme[]) {
        securitySchemes.forEach(scheme => {
            // Use scheme type as key, or add custom naming
            const key = this.getSchemeKey(scheme);
            this.schemes.set(key, scheme);
        });
    }

    /**
     * Get authentication headers based on security scheme
     */
    async getAuthHeaders(
        schemeName: string,
        credentials?: SecurityCredentials
    ): Promise<Record<string, string>> {
        if (schemeName === 'none' || !credentials) {
            return {};
        }

        const scheme = this.schemes.get(schemeName);
        if (!scheme) {
            throw new Error(`Security scheme not found: ${schemeName}`);
        }

        switch (scheme.type) {
            case 'apiKey':
                return this.getAPIKeyHeaders(scheme as APIKeySecurityScheme, credentials);

            case 'http':
                return this.getHTTPAuthHeaders(scheme as HTTPAuthSecurityScheme, credentials);

            case 'oauth2':
                return await this.getOAuth2Headers(scheme as OAuth2SecurityScheme, credentials);

            case 'openIdConnect':
                return this.getOIDCHeaders(scheme as OpenIdConnectSecurityScheme, credentials);

            case 'mutualTLS':
                // mTLS is handled at the connection level, not headers
                return {};

            default:
                throw new Error(`Unsupported security scheme type: ${(scheme as any).type}`);
        }
    }

    /**
     * API Key authentication
     */
    private getAPIKeyHeaders(
        scheme: APIKeySecurityScheme,
        credentials: SecurityCredentials
    ): Record<string, string> {
        if (!credentials.apiKey) {
            throw new Error('API key not provided');
        }

        const headers: Record<string, string> = {};

        switch (scheme.in) {
            case 'header':
                headers[scheme.name] = credentials.apiKey;
                break;
            case 'query':
                // Query params handled elsewhere
                break;
            case 'cookie':
                headers['Cookie'] = `${scheme.name}=${credentials.apiKey}`;
                break;
        }

        return headers;
    }

    /**
     * HTTP authentication (Bearer, Basic, etc.)
     */
    private getHTTPAuthHeaders(
        scheme: HTTPAuthSecurityScheme,
        credentials: SecurityCredentials
    ): Record<string, string> {
        const headers: Record<string, string> = {};

        switch (scheme.scheme.toLowerCase()) {
            case 'bearer':
                if (!credentials.bearerToken) {
                    throw new Error('Bearer token not provided');
                }
                headers['Authorization'] = `Bearer ${credentials.bearerToken}`;
                break;

            case 'basic':
                // Assume apiKey contains "username:password"
                if (!credentials.apiKey) {
                    throw new Error('Basic auth credentials not provided');
                }
                const encoded = Buffer.from(credentials.apiKey).toString('base64');
                headers['Authorization'] = `Basic ${encoded}`;
                break;

            default:
                throw new Error(`Unsupported HTTP auth scheme: ${scheme.scheme}`);
        }

        return headers;
    }

    /**
     * OAuth2 authentication
     */
    private async getOAuth2Headers(
        scheme: OAuth2SecurityScheme,
        credentials: SecurityCredentials
    ): Promise<Record<string, string>> {
        if (!credentials.oauth2) {
            throw new Error('OAuth2 credentials not provided');
        }

        // Check if we have a valid cached token
        const cacheKey = `oauth2_${credentials.oauth2.clientId}`;
        const cached = this.tokenCache.get(cacheKey);

        if (cached && cached.expiry > new Date()) {
            return {
                'Authorization': `Bearer ${cached.token}`
            };
        }

        // Get new token based on flow type
        let accessToken: string;

        if (scheme.flows.ClientCredentials) {
            accessToken = await this.getClientCredentialsToken(
                scheme.flows.ClientCredentials,
                credentials.oauth2
            );
        } else if (scheme.flows.authorizationCode && credentials.oauth2.refreshToken) {
            accessToken = await this.refreshAccessToken(
                scheme.flows.authorizationCode,
                {
                    refreshToken:credentials.oauth2.refreshToken,
                    clientId:credentials.oauth2.clientId,
                    clientSecret:credentials.oauth2.clientSecret
                }
                // credentials.oauth2
            );
        } else if (credentials.oauth2.accessToken) {
            accessToken = credentials.oauth2.accessToken;
        } else {
            throw new Error('No valid OAuth2 flow or token available');
        }

        // Cache the token
        this.tokenCache.set(cacheKey, {
            token: accessToken,
            expiry: new Date(Date.now() + 3600000) // 1 hour default
        });

        return {
            'Authorization': `Bearer ${accessToken}`
        };
    }

    /**
     * Get OAuth2 client credentials token
     */
    private async getClientCredentialsToken(
        flow: ClientCredentialsAuthFlow,
        credentials: { clientId: string; clientSecret: string }
    ): Promise<string> {
        try {
            const response = await axios.post(flow.tokenUrl, {
                grant_type: 'client_credentials',
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                scope: Object.keys(flow.scopes).join(' ')
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return response.data.access_token;
        } catch (error:any) {
            throw new Error(`OAuth2 token request failed: ${error.message || 'Unknown error'}`);
        }

    }

    /**
     * Refresh OAuth2 access token
     */
    private async refreshAccessToken(
        flow: AuthorizationCodeAuthFlow,
        credentials: { refreshToken: string; clientId: string; clientSecret: string }
    ): Promise<string> {
        if (!flow.refreshUrl) {
            throw new Error('Refresh URL not provided');
        }

        try {
            const response = await axios.post(flow.refreshUrl, {
                grant_type: 'refresh_token',
                refresh_token: credentials.refreshToken,
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return response.data.access_token;
        } catch (error:any) {
            throw new Error(`OAuth2 token refresh failed: ${error.message}`);
        }
    }

    /**
     * OpenID Connect authentication
     */
    private getOIDCHeaders(
        scheme: OpenIdConnectSecurityScheme,
        credentials: SecurityCredentials
    ): Record<string, string> {
        if (!credentials.oidc) {
            throw new Error('OIDC credentials not provided');
        }

        return {
            'Authorization': `Bearer ${credentials.oidc.accessToken}`
        };
    }

    /**
     * Get TLS configuration for mutual TLS
     */
    async getTLSConfig(
        schemeName: string,
        credentials?: SecurityCredentials
    ): Promise<any> {
        const scheme = this.schemes.get(schemeName);

        if (!scheme || scheme.type !== 'mutualTLS') {
            return null;
        }

        if (!credentials?.mtls) {
            throw new Error('mTLS credentials not provided');
        }

        return {
            cert: credentials.mtls.clientCert,
            key: credentials.mtls.clientKey,
            ca: credentials.mtls.caCert,
            rejectUnauthorized: true
        };
    }

    /**
     * Generate code challenge for PKCE
     */
    generatePKCEChallenge(): { verifier: string; challenge: string } {
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256')
            .update(verifier)
            .digest('base64url');

        return { verifier, challenge };
    }

    /**
     * Validate JWT token
     */
    validateJWT(token: string, secret: string): any {
        try {
            return jwt.verify(token, secret);
        } catch (error:any) {
            throw new Error(`JWT validation failed: ${error.message}`);
        }
    }

    /**
     * Get scheme key for storage
     */
    private getSchemeKey(scheme: SecurityScheme): string {
        // You could enhance this to support multiple schemes of same type
        return scheme.type;
    }

    /**
     * Get all registered security schemes
     */
    getSecuritySchemes(): SecurityScheme[] {
        return Array.from(this.schemes.values());
    }
}