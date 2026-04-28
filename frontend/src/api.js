import axios from 'axios';
import toast from 'react-hot-toast';
import { API_BASE_URL } from './constants';

// Axios 인스턴스 생성
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터: 토큰 자동 삽입
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 응답 인터셉터: 에러 공통 처리
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const { response } = error;

    if (response) {
      // 서버에서 응답이 온 경우
      const message = response.data?.detail || response.data?.message || '문제가 발생했습니다.';
      
      switch (response.status) {
        case 401:
          // 권한 없음: 토큰 만료 등
          toast.error('세션이 만료되었습니다. 다시 로그인해주세요.');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          // 필요한 경우 로그인 페이지로 리다이렉트
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
          break;
        
        case 403:
          toast.error('접근 권한이 없습니다.');
          break;
        
        case 500:
          toast.error('서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          break;
        
        default:
          toast.error(message);
      }
    } else if (error.request) {
      // 요청은 보냈으나 응답을 받지 못한 경우 (네트워크 에러 등)
      toast.error('서버와 통신할 수 없습니다. 네트워크 연결을 확인해주세요.');
    } else {
      // 요청 설정 중 에러 발생
      toast.error('요청 중 오류가 발생했습니다.');
    }

    return Promise.reject(error);
  }
);

export default api;
