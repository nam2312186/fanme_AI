import { useHandleSignInCallback } from '@logto/react';

export function LogtoCallback() {
  const { isLoading } = useHandleSignInCallback(() => {
    window.location.replace('/');
  });

  return (
    <div className="callback-page">
      <div className="callback-card">
        <div className="callback-spinner" />
        <h2>Đang hoàn tất đăng nhập...</h2>
        <p>Vui lòng chờ trong giây lát.</p>
      </div>
    </div>
  );
}
