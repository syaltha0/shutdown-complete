// What the planner shell needs to know about signing in without loading the sign-in screens: which paths are theirs,
// and the server's password rules ('basic' unless its owner chose 'strong'), known from /api/auth/state.
import type { PasswordPolicy } from './api';

let policy: PasswordPolicy = 'basic';
export const setPasswordPolicy = (p?: PasswordPolicy) => { policy = p === 'strong' ? 'strong' : 'basic'; };
export const passwordPolicy = () => policy;
export const isAuthPath = (p: string) => ['/login', '/register', '/forgot', '/reset', '/verify', '/setup'].includes(p);
