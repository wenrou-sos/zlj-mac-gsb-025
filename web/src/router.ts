import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '概览' } },
  { path: '/registrations', name: 'registrations', component: () => import('./views/RegistrationsView.vue'), meta: { title: '挂单登记' } },
  { path: '/rooms', name: 'rooms', component: () => import('./views/RoomsView.vue'), meta: { title: '寮房床位' } },
  { path: '/probation', name: 'probation', component: () => import('./views/ProbationView.vue'), meta: { title: '考察与羯磨' } },
  { path: '/residents', name: 'residents', component: () => import('./views/ResidentsView.vue'), meta: { title: '常住档案' } },
  { path: '/attendance', name: 'attendance', component: () => import('./views/AttendanceView.vue'), meta: { title: '早晚课考勤' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
