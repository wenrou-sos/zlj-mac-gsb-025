<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import type { Dashboard } from '../types';

const router = useRouter();
const data = ref<Dashboard | null>(null);
const loading = ref(false);

const load = async () => {
  loading.value = true;
  try {
    data.value = await api<Dashboard>('/dashboard');
  } finally {
    loading.value = false;
  }
};
onMounted(load);
defineExpose({ load });
</script>

<template>
  <n-spin :show="loading">
    <div v-if="data">
      <!-- 统计卡片 -->
      <n-grid :cols="5" :x-gap="14" responsive="screen" item-responsive>
        <n-grid-item span="5 m:1">
          <n-card hoverable>
            <n-statistic label="挂单中僧人" :value="data.stats.active_guests">
              <template #suffix>位</template>
            </n-statistic>
          </n-card>
        </n-grid-item>
        <n-grid-item span="5 m:1">
          <n-card hoverable>
            <n-statistic label="考察期中" :value="data.stats.on_probation">
              <template #suffix>位</template>
            </n-statistic>
          </n-card>
        </n-grid-item>
        <n-grid-item span="5 m:1">
          <n-card hoverable>
            <n-statistic label="常住僧人" :value="data.stats.residents">
              <template #suffix>位</template>
            </n-statistic>
          </n-card>
        </n-grid-item>
        <n-grid-item span="5 m:1">
          <n-card hoverable>
            <n-statistic label="床位入住" :value="data.stats.beds_used">
              <template #suffix>/ {{ data.stats.beds_total }}</template>
            </n-statistic>
          </n-card>
        </n-grid-item>
        <n-grid-item span="5 m:1">
          <n-card hoverable :bordered="true">
            <n-statistic label="入住率">
              <template #suffix>%</template>
              {{ data.stats.beds_total ? Math.round((data.stats.beds_used / data.stats.beds_total) * 100) : 0 }}
            </n-statistic>
          </n-card>
        </n-grid-item>
      </n-grid>

      <n-grid :cols="2" :x-gap="14" :y-gap="14" responsive="screen" item-responsive style="margin-top: 14px">
        <!-- 缺勤提醒 -->
        <n-grid-item span="2 m:1">
          <n-card title="🔔 缺勤提醒（累计满 3 次）" size="small">
            <n-empty v-if="!data.absenceAlerts.length" description="暂无缺勤预警，海众精进" />
            <n-space v-else vertical>
              <n-alert
                v-for="a in data.absenceAlerts"
                :key="a.person_type + a.person_id"
                type="error"
                :show-icon="true"
              >
                <b>{{ a.dharma_name }}</b>
                （{{ a.person_type === 'resident' ? '常住' : '挂单' }}）
                已累计缺勤
                <n-text strong type="error">{{ a.absent_count }}</n-text>
                次，最近缺勤：{{ a.last_absent_date }}
                <template #action>
                  <n-button size="tiny" @click="router.push('/attendance')">去考勤</n-button>
                </template>
              </n-alert>
            </n-space>
          </n-card>
        </n-grid-item>

        <!-- 挂单超期 -->
        <n-grid-item span="2 m:1">
          <n-card title="⏳ 挂单超期未续单" size="small">
            <n-empty v-if="!data.overdue.length" description="暂无超期挂单" />
            <n-table v-else size="small" :single-line="false">
              <thead><tr><th>法名</th><th>预计离寺</th><th>超期</th><th></th></tr></thead>
              <tbody>
                <tr v-for="o in data.overdue" :key="o.id">
                  <td>{{ o.dharma_name }}</td>
                  <td>{{ o.due_date }}</td>
                  <td><n-tag type="error" size="small">{{ o.overdue_days }} 天</n-tag></td>
                  <td>
                    <n-button size="tiny" text @click="router.push('/registrations')">处理</n-button>
                  </td>
                </tr>
              </tbody>
            </n-table>
          </n-card>
        </n-grid-item>

        <!-- 考察到期 -->
        <n-grid-item span="2 m:1">
          <n-card title="📿 考察期进度" size="small">
            <n-empty v-if="!data.probationDue.length" description="暂无考察中僧人" />
            <n-table v-else size="small" :single-line="false">
              <thead><tr><th>法名</th><th>考察起</th><th>考察止</th><th>剩余</th></tr></thead>
              <tbody>
                <tr v-for="p in data.probationDue" :key="p.id">
                  <td>{{ p.dharma_name }}</td>
                  <td>{{ p.start_date }}</td>
                  <td>{{ p.end_date }}</td>
                  <td>
                    <n-tag :type="p.days_left <= 7 ? 'warning' : 'default'" size="small">
                      {{ p.days_left < 0 ? `已逾期 ${-p.days_left} 天` : `剩 ${p.days_left} 天` }}
                    </n-tag>
                  </td>
                </tr>
              </tbody>
            </n-table>
            <template #footer>
              <n-button size="small" @click="router.push('/probation')">前往羯磨办理 →</n-button>
            </template>
          </n-card>
        </n-grid-item>

        <!-- 寮房入住 -->
        <n-grid-item span="2 m:1">
          <n-card title="🛏️ 寮房入住情况" size="small">
            <n-space vertical>
              <div v-for="r in data.occupancy" :key="r.room_no">
                <n-space justify="space-between" style="margin-bottom: 2px">
                  <span>{{ r.room_no }}</span>
                  <n-text depth="3">{{ r.used }}/{{ r.total }}</n-text>
                </n-space>
                <n-progress
                  type="line"
                  :percentage="r.total ? (r.used / r.total) * 100 : 0"
                  :show-indicator="false"
                  :height="8"
                  :status="r.used >= r.total ? 'error' : 'success'"
                />
              </div>
            </n-space>
          </n-card>
        </n-grid-item>
      </n-grid>
    </div>
  </n-spin>
</template>
