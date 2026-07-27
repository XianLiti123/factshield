import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles.css'
import '@xyflow/react/dist/style.css'

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
          colorPrimary: '#246bfd',
          colorText: '#172033',
          colorTextSecondary: '#68738a',
          colorBgLayout: '#f4f6fa',
          colorBorderSecondary: '#e8ebf2',
          borderRadius: 8,
          fontFamily: "MiSans, sans-serif",
        },
        components: {
          Button: { controlHeight: 36 },
          Table: { headerBg: '#f7f8fb', headerColor: '#68738a' },
          Tabs: { itemSelectedColor: '#172033', inkBarColor: '#246bfd' },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
)
