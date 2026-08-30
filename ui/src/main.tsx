import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles.css'
import '@xyflow/react/dist/style.css'
import './workspace-theme.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#084d5c',
          colorInfo: '#0d6575',
          colorText: '#17302f',
          colorTextSecondary: '#70817e',
          colorBgLayout: '#edf3f0',
          colorBorderSecondary: '#e1e9e6',
          borderRadius: 8,
          fontFamily: "MiSans",
        },
        components: {
          Button: { controlHeight: 36 },
          Table: { headerBg: '#eef6f3', headerColor: '#61736f' },
          Tabs: { itemSelectedColor: '#17302f', inkBarColor: '#0d6575' },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
)
