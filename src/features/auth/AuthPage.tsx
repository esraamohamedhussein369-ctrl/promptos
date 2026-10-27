import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  registerAccount,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from '../../application/auth/authClient'
import { useAuth } from '../../application/auth/AuthContext'

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify'

export function AuthPage() {
  const { user, isLoading, serverError, authenticate, refreshSession } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const resetToken = searchParams.get('reset')
  const verificationToken = searchParams.get('verify')
  const [mode, setMode] = useState<AuthMode>(
    resetToken ? 'reset' : verificationToken ? 'verify' : 'login',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (resetToken) setMode('reset')
    else if (verificationToken) setMode('verify')
    else setMode('login')
  }, [resetToken, verificationToken])

  if (isLoading) return <main className="auth-page"><p role="status">Checking your session…</p></main>
  if (user && !resetToken && !verificationToken) return <Navigate to="/workspace" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      if (mode === 'login') {
        await authenticate(email, password)
        navigate('/workspace', { replace: true })
      } else if (mode === 'register') {
        const result = await registerAccount(email, password)
        setSuccess(result.message ?? 'Check your email to verify your account.')
        setMode('login')
      } else if (mode === 'forgot') {
        const result = await requestPasswordReset(email)
        setSuccess(result.message ?? 'If an account exists, reset instructions will be sent.')
        setMode('login')
      } else if (mode === 'verify' && verificationToken) {
        const result = await verifyEmail(verificationToken)
        setSuccess(result.message ?? 'Email verified. You can sign in now.')
        setMode('login')
        setSearchParams({}, { replace: true })
      } else if (resetToken) {
        const result = await resetPassword(resetToken, password)
        setSuccess(result.message ?? 'Password updated. Sign in with your new password.')
        await refreshSession()
        setMode('login')
        setSearchParams({}, { replace: true })
      } else {
        throw new Error('The password reset link is missing or invalid.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete this account request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function sendVerificationAgain() {
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      const result = await resendVerification(email)
      setSuccess(result.message ?? 'If the account needs verification, a new link will be sent.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send a verification email.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const heading = {
    login: 'Welcome back',
    register: 'Create an account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
    verify: 'Verify your email',
  }[mode]
  const description = {
    login: 'Sign in to access your prompts and AI tools.',
    register: 'Create your account to start building and evaluating prompts. Verify your email before signing in.',
    forgot: 'Enter your account email. If it is registered, we will send a reset link.',
    reset: 'Choose a new password with at least 12 characters.',
    verify: 'Confirm your email address to activate your PromptOS account.',
  }[mode]

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">P</span>
          <div><strong>PromptOS</strong><small>Engineering Workbench</small></div>
        </div>
        <p className="eyebrow">AI PROMPT WORKSPACE</p>
        <h1>{heading}</h1>
        <p className="lede">{description}</p>
        {serverError && <div className="alert error" role="alert">{serverError}</div>}
        {success && <div className="alert success" role="status">{success}</div>}
        {mode === 'reset' && !resetToken && (
          <div className="alert error" role="alert">This password reset link is missing. Request a new link below.</div>
        )}
        {mode === 'verify' && !verificationToken && (
          <div className="alert error" role="alert">This verification link is missing. Request a new verification email.</div>
        )}
        <form className="auth-form" onSubmit={submit}>
          {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
          )}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <label className="field">
              <span>Password <small>{mode !== 'login' ? 'At least 12 characters' : ''}</small></span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'login' ? 1 : 12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {error && <div className="alert error" role="alert">{error}</div>}
          <button className="button primary auth-submit" type="submit" disabled={isSubmitting || !!serverError || (mode === 'reset' && !resetToken) || (mode === 'verify' && !verificationToken)}>
            {isSubmitting ? 'Please wait…' : {
              login: 'Sign in',
              register: 'Create account',
              forgot: 'Send reset link',
              reset: 'Update password',
              verify: 'Confirm email',
            }[mode]}
          </button>
          {((mode === 'login' && /verify your email/i.test(error)) ||
            (mode === 'register' && /account was created/i.test(error))) && (
            <button className="auth-switch" type="button" onClick={() => void sendVerificationAgain()} disabled={isSubmitting}>
              Resend verification email
            </button>
          )}
        </form>
        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" className="auth-switch" onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}>Forgot password?</button>
              <button type="button" className="auth-switch" onClick={() => { setMode('register'); setError(''); setSuccess('') }}>Create an account</button>
            </>
          )}
          {mode === 'register' && <button type="button" className="auth-switch" onClick={() => { setMode('login'); setError(''); setSuccess('') }}>Already have an account? Sign in</button>}
          {mode !== 'login' && mode !== 'register' && <button type="button" className="auth-switch" onClick={() => { setMode('login'); setError(''); setSuccess('') }}>Back to sign in</button>}
        </div>
        <p className="auth-security">Passwords are hashed on the server. Sessions use HTTP-only cookies. Your local prompts remain stored only in this browser.</p>
      </section>
    </main>
  )
}
