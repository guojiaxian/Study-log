import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '首页' } },
  { path: '/manage', name: 'manage', component: () => import('../views/Manage.vue'), meta: { title: '管理' } },
  { path: '/entry', redirect: '/manage' },
  { path: '/settings', redirect: '/manage' },
  { path: '/entry/manual', name: 'entry-manual', component: () => import('../views/EntryManual.vue'), meta: { title: '手动录入' } },
  { path: '/entry/ai', name: 'entry-ai', component: () => import('../views/EntryAi.vue'), meta: { title: '智能批量录入' } },
  { path: '/trend', name: 'trend', component: () => import('../views/Trend.vue'), meta: { title: '趋势分析' } },
  { path: '/exams', name: 'exams', component: () => import('../views/ExamList.vue'), meta: { title: '历史成绩' } },
  { path: '/exams/:id', name: 'exam-detail', component: () => import('../views/ExamDetail.vue'), meta: { title: '考试详情' } },
  { path: '/analysis', name: 'analysis', component: () => import('../views/Analysis.vue'), meta: { title: '智能分析' } },
  { path: '/targets', name: 'targets', component: () => import('../views/Targets.vue'), meta: { title: '目标院校' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => {
  const name = to.meta?.title ?? '';
  document.title = name ? `${name} · 孙晗菲的学习记录` : '孙晗菲的学习记录';
});

export default router;
