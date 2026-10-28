export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/bind/index',
    'pages/task/index',
    'pages/start/index',
    'pages/inspect/index',
    'pages/defect/index',
    'pages/review/list',
    'pages/review/detail',
    'pages/me/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#2563eb',
    navigationBarTitleText: 'FabricQC 验布',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f7fb',
  },
  // 拍照与扫码需要的隐私接口声明
  requiredPrivateInfos: [],
});
