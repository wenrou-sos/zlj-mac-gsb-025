<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NIcon, NBadge } from 'naive-ui';
import type { SelectOption } from 'naive-ui';
import { api } from './api';
import type { Dashboard } from './types';

const route = useRoute();
const router = useRouter();
const collapsed = ref(false);
const dashboard = ref<Dashboard | null>(null);

const refreshAlerts = async () => {
  try {
    dashboard.value = await api<Dashboard>('/dashboard');
  } catch {
    /* 静默 */
  }
};
onMounted(() => {
  refreshAlerts();
  setInterval(refreshAlerts, 30000);
});

const alertCount = computed(() => dashboard.value?.absenceAlerts.length ?? 0);

const renderIcon = (char: string) => () =>
  h('span', { style: 'font-size:16px' }, char);

const menuOptions = computed<SelectOption[]>(() => [
  { label: '概览', key: '/', icon: renderIcon('🏠') },
  { label: '挂单登记', key: '/registrations', icon: renderIcon('📝') },
  { label: '寮房床位', key: '/rooms', icon: renderIcon('🛏️') },
  { label: '考察与羯磨', key: '/probation', icon: renderIcon('📿') },
  { label: '常住档案', key: '/residents', icon: renderIcon('📚') },
  {
    label: () =>
      h('span', { style: 'display:flex;align-items:center;gap:8px' }, [
        h('span', '早晚课考勤'),
        alertCount.value
          ? h(NBadge, { value: alertCount.value, type: 'error', max: 9 }, { default: () => '' })
          : null,
      ]),
    key: '/attendance',
    icon: renderIcon('🔔'),
  },
]);

const activeKey = computed(() => route.path);
</script>

<template>
  <n-config-provider>
    <n-message-provider>
      <n-layout has-sider style="height: 100vh">
        <n-layout-sider
          bordered
          collapse-mode="width"
          :collapsed-width="64"
          :width="220"
          :collapsed="collapsed"
          show-trigger
          @collapse="collapsed = true"
          @expand="collapsed = false"
        >
          <div
            class="brand"
            :class="{ center: collapsed }"
          >
            <span class="brand-icon">☸</span>
            <span v-if="!collapsed" class="brand-text">丛林客堂<br /><small>挂单与常住管理</small></span>
          </div>
          <n-menu
            :collapsed="collapsed"
            :collapsed-width="64"
            :collapsed-icon-size="18"
            :options="menuOptions"
            :value="activeKey"
            @update:value="(k: string) => router.push(k)"
          />
          <div v-if="!collapsed" class="sider-footer">
            <n-text depth="3" style="font-size: 12px">伽蓝宁静 · 海众安和</n-text>
          </div>
        </n-layout-sider>

        <n-layout>
          <n-layout-header bordered class="app-header">
            <h3>{{ route.meta.title ?? '' }}</h3>
            <n-text depth="3" style="font-size: 13px">寺院僧人挂单与常住管理平台</n-text>
          </n-layout-header>
          <n-layout-content content-style="padding: 20px;">
            <router-view @changed="refreshAlerts" />
          </n-layout-content>
        </n-layout>
      </n-layout>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.brand {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
}
.brand.center { justify-content: center; padding: 0; }
.brand-icon { font-size: 26px; color: #8a6d3b; }
.brand-text { font-size: 15px; font-weight: 600; line-height: 1.3; color: #5a4a2f; }
.brand-text small { font-weight: 400; font-size: 11px; color: #999; }
.sider-footer { position: absolute; bottom: 16px; left: 0; right: 0; text-align: center; }
.app-header {
  height: 56px;
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 0 24px;
}
.app-header h3 { margin: 0; }
</style>
