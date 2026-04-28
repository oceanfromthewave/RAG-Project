import React from 'react';

/**
 * 전역 에러 바운더리: 자식 컴포넌트에서 발생하는 런타임 에러를 포착하여 폴백 UI를 보여줍니다.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // 다음 렌더링에서 폴백 UI가 보이도록 상태를 업데이트합니다.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // 에러 리포팅 서비스에 에러를 기록할 수 있습니다.
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // 에러 발생 시 커스텀 폴백 UI 제공
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          textAlign: 'center',
          background: '#fcfaf7',
          color: '#2a241e'
        }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>문제가 발생했습니다.</h1>
          <p style={{ opacity: 0.8, marginBottom: '2rem' }}>
            애플리케이션을 렌더링하는 중 예기치 못한 에러가 발생했습니다.
          </p>
          <div style={{
            background: '#fff',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #e4dbd0',
            maxWidth: '600px',
            overflow: 'auto',
            marginBottom: '2rem',
            textAlign: 'left'
          }}>
            <code style={{ fontSize: '0.85rem', color: '#c44530' }}>
              {this.state.error && this.state.error.toString()}
            </code>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              background: '#3186C0',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            새로고침하여 복구 시도
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
