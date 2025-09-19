import React from "react";
import { createRoot } from "react-dom/client";

// 당장은 뷰어를 올리지 않고, 나중에 Desktop의 ViewerRoute를 포팅할 예정.
// 최소한의 마운트만 해서 빌드 에러를 제거합니다.
function App() {
  return (
    <div style={{padding: 24}}>
      <h1>iTwin Web (placeholder)</h1>
      <p>웹 뷰어는 이후 데스크톱 ViewerRoute를 포팅해 붙일 예정입니다.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);