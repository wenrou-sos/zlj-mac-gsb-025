<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import { NButton, NSpace, NTag, NPopconfirm, NDataTable, useMessage } from 'naive-ui';
import { api, apiAction } from '../api';
import type { Registration, AvailableBed } from '../types';

const emit = defineEmits<{ changed: [] }>();
const message = useMessage();
const list = ref<Registration[]>([]);
const loading = ref(false);
const statusFilter = ref<string>('挂单中');

const showCreate = ref(false);
const form = ref({
  dharma_name: '',
  home_monastery: '',
  ordination_no: '',
  arrival_date: new Date().toISOString().slice(0, 10),
  planned_stay_days: 7,
  phone: '',
});

const showBed = ref(false);
const bedTarget = ref<Registration | null>(null);
const beds = ref<AvailableBed[]>([]);
const bedId = ref<number | null>(null);

const showExtend = ref(false);
const extendTarget = ref<Registration | null>(null);
const extendDays = ref(7);

const showProbation = ref(false);
const probationTarget = ref<Registration | null>(null);
const probationMonths = ref(3);

const load = async () => {
  loading.value = true;
  try {
    list.value = await api<Registration[]>(
      `/registrations?status=${encodeURIComponent(statusFilter.value)}`,
    );
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const resetForm = () => {
  form.value = {
    dharma_name: '', home_monastery: '', ordination_no: '',
    arrival_date: new Date().toISOString().slice(0, 10),
    planned_stay_days: 7, phone: '',
  };
};

const create = async () => {
  const r = await apiAction('挂单登记', () =>
    api('/registrations', { method: 'POST', body: JSON.stringify(form.value) }),
  );
  if (r) {
    showCreate.value = false;
    resetForm();
    load();
    emit('changed');
  }
};

const openBed = async (row: Registration) => {
  bedTarget.value = row;
  beds.value = await api<AvailableBed[]>('/beds/available');
  bedId.value = null;
  showBed.value = true;
};

const assignBed = async () => {
  if (!bedTarget.value || !bedId.value) return message.warning('请选择床位');
  const r = await apiAction('安排床位', () =>
    api(`/registrations/${bedTarget.value!.id}/assign-bed`, {
      method: 'POST',
      body: JSON.stringify({ bed_id: bedId.value }),
    }),
  );
  if (r) {
    showBed.value = false;
    load();
  }
};

const checkout = async (row: Registration) => {
  const r = await apiAction(`为 ${row.dharma_name} 办理退单`, () =>
    api(`/registrations/${row.id}/checkout`, { method: 'POST', body: '{}' }),
  );
  if (r) {
    load();
    emit('changed');
  }
};

const openExtend = (row: Registration) => {
  extendTarget.value = row;
  extendDays.value = 7;
  showExtend.value = true;
};

const doExtend = async () => {
  const r = await apiAction('续单', () =>
    api(`/registrations/${extendTarget.value!.id}/extend`, {
      method: 'POST',
      body: JSON.stringify({ days: extendDays.value }),
    }),
  );
  if (r) {
    showExtend.value = false;
    load();
  }
};

const openProbation = (row: Registration) => {
  probationTarget.value = row;
  probationMonths.value = 3;
  showProbation.value = true;
};

const doProbation = async () => {
  const r = await apiAction('登记考察期', () =>
    api(`/registrations/${probationTarget.value!.id}/probation`, {
      method: 'POST',
      body: JSON.stringify({ months: probationMonths.value }),
    }),
  );
  if (r) {
    showProbation.value = false;
    load();
    emit('changed');
  }
};

const statusType = (s: string) =>
  s === '挂单中' ? 'success' : s === '转常住' ? 'info' : 'default';
</script>

<template>
  <n-card>
    <template #header>
      <n-space align="center">
        <n-radio-group v-model:value="statusFilter" button-style="solid" @update:value="load">
          <n-radio-button value="挂单中">挂单中</n-radio-button>
          <n-radio-button value="已退单">已退单</n-radio-button>
          <n-radio-button value="转常住">转常住</n-radio-button>
          <n-radio-button value="">全部</n-radio-button>
        </n-radio-group>
      </n-space>
    </template>
    <template #header-extra>
      <n-button type="primary" @click="showCreate = true">＋ 新挂单登记</n-button>
    </template>

    <n-data-table
      :loading="loading"
      :columns="[
        { title: '法名', key: 'dharma_name', width: 90 },
        { title: '出家寺庙', key: 'home_monastery' },
        { title: '戒牒编号', key: 'ordination_no', width: 130 },
        { title: '到寺日期', key: 'arrival_date', width: 110 },
        { title: '预计住', key: 'planned_stay_days', width: 80, render: r => `${r.planned_stay_days} 天` },
        {
          title: '床位', key: 'bed', width: 130,
          render: r => r.room_no ? `${r.room_no} · ${r.bed_no}` : '—',
        },
        {
          title: '状态', key: 'status', width: 90,
          render: r => h(NTag, { type: statusType(r.status), size: 'small' }, { default: () => r.status }),
        },
        {
          title: '考勤', key: 'absent', width: 80,
          render: r => r.absent_count >= 3
            ? h(NTag, { type: 'error', size: 'small' }, { default: () => `缺勤 ${r.absent_count}` })
            : r.absent_count
              ? h(NTag, { type: 'warning', size: 'small' }, { default: () => `缺勤 ${r.absent_count}` })
              : '正常',
        },
        {
          title: '操作', key: 'actions', width: 300,
          render: (row) =>
            h(NSpace, { size: 4 }, {
              default: () => {
                const btns = [];
                if (row.status === '挂单中') {
                  btns.push(h(NButton, { size: 'tiny', onClick: () => openBed(row) }, { default: () => (row.bed_id ? '调整床位' : '安排床位') }));
                  btns.push(h(NButton, { size: 'tiny', onClick: () => openExtend(row) }, { default: () => '续单' }));
                  btns.push(h(NButton, { size: 'tiny', type: 'primary', ghost: true, onClick: () => openProbation(row) }, { default: () => '申请常住考察' }));
                  btns.push(h(NPopconfirm, { onPositiveClick: () => checkout(row) }, {
                    trigger: () => h(NButton, { size: 'tiny', type: 'error', ghost: true }, { default: () => '退单' }),
                    default: () => `确认为 ${row.dharma_name} 办理退单？床位将自动释放。`,
                  }));
                }
                return btns;
              },
            }),
        },
      ]"
      :data="list"
      :row-key="(r: Registration) => r.id"
      :bordered="false"
    />
  </n-card>

  <!-- 新建挂单 -->
  <n-modal v-model:show="showCreate" preset="card" title="云游僧人挂单登记" style="width: 520px">
    <n-form label-placement="left" label-width="92px">
      <n-form-item label="法名" required>
        <n-input v-model:value="form.dharma_name" placeholder="如：法空" />
      </n-form-item>
      <n-form-item label="出家寺庙" required>
        <n-input v-model:value="form.home_monastery" placeholder="如：河南嵩山少林寺" />
      </n-form-item>
      <n-form-item label="戒牒编号" required>
        <n-input v-model:value="form.ordination_no" placeholder="如：JD2024071" />
      </n-form-item>
      <n-form-item label="到寺日期" required>
        <n-input v-model:value="form.arrival_date" placeholder="YYYY-MM-DD" />
      </n-form-item>
      <n-form-item label="预计住几天" required>
        <n-input-number v-model:value="form.planned_stay_days" :min="1" :max="3650" />
      </n-form-item>
      <n-form-item label="联系电话">
        <n-input v-model:value="form.phone" placeholder="选填" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="showCreate = false">取消</n-button>
        <n-button type="primary" @click="create">登记挂单</n-button>
      </n-space>
    </template>
  </n-modal>

  <!-- 安排床位 -->
  <n-modal v-model:show="showBed" preset="card" title="安排寮房床位" style="width: 460px">
    <n-text depth="3" style="display: block; margin-bottom: 12px">
      为 <b>{{ bedTarget?.dharma_name }}</b>（{{ bedTarget?.home_monastery }}）安排床位
    </n-text>
    <n-select
      v-model:value="bedId"
      placeholder="选择空闲床位"
      :options="beds.map(b => ({ label: `${b.room_no} · ${b.bed_no}`, value: b.id }))"
    />
    <template #footer>
      <n-space justify="end">
        <n-button @click="showBed = false">取消</n-button>
        <n-button type="primary" @click="assignBed">确认入住</n-button>
      </n-space>
    </template>
  </n-modal>

  <!-- 续单 -->
  <n-modal v-model:show="showExtend" preset="card" title="延长挂单" style="width: 380px">
    <n-text depth="3" style="display: block; margin-bottom: 12px">
      {{ extendTarget?.dharma_name }} 当前预计住 {{ extendTarget?.planned_stay_days}} 天
    </n-text>
    <n-input-number v-model:value="extendDays" :min="1" :max="3650">
      <template #suffix>天</template>
    </n-input-number>
    <template #footer>
      <n-space justify="end">
        <n-button @click="showExtend = false">取消</n-button>
        <n-button type="primary" @click="doExtend">续单</n-button>
      </n-space>
    </template>
  </n-modal>

  <!-- 申请考察 -->
  <n-modal v-model:show="showProbation" preset="card" title="申请常住考察期" style="width: 420px">
    <n-text depth="3" style="display: block; margin-bottom: 12px">
      {{ probationTarget?.dharma_name }} 发心常住，考察期为 3–6 个月
    </n-text>
    <n-radio-group v-model:value="probationMonths">
      <n-radio :value="3">三个月</n-radio>
      <n-radio :value="4">四个月</n-radio>
      <n-radio :value="5">五个月</n-radio>
      <n-radio :value="6">六个月</n-radio>
    </n-radio-group>
    <template #footer>
      <n-space justify="end">
        <n-button @click="showProbation = false">取消</n-button>
        <n-button type="primary" @click="doProbation">开始考察</n-button>
      </n-space>
    </template>
  </n-modal>
</template>
