import { Navigate, useSearchParams } from 'react-router-dom';

export function SignUp() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';
  return (
    <Navigate
      to={`/auth/sign-in${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
      replace
    />
  );
}
