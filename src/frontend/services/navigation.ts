// 라우터 밖(툴바 Provider 등)에서도 안전하게 라우팅하기 위한 헬퍼

let _navigate: ((path: string) => void) | null = null;

// 라우터 안에서 1회 등록
export function registerNavigator(fn: (path: string) => void) {
  _navigate = fn;
}

// 경로 이동 (등록 안 되어 있으면 최후의 수단으로 location 사용)
export function navigateTo(path: string) {
  if (_navigate) return _navigate(path);
  try {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.assign(path);
  }
}

// ProjectSitePanel로 이동 (필요시 경로만 바꿔주세요)
export function goProjectHome() {
  navigateTo("/home"); // ← ProjectSitePanel의 실제 경로로 교체 가능. 예: "/projects"
}

// 로그인 패널로 이동
export function goLoginPanel() {
  navigateTo("/login");         // 로그인(또는 LoginPanel) 라우트 경로에 맞게 수정
}