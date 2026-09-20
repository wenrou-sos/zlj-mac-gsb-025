<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import { NButton, NSpace, NTag, NPopconfirm, NDataTable } from 'naive-ui';
import { api, apiAction } from '../api';
import type { Resident } from '../types';

const emit = defineEmits<{ changed: [] }>();
const list = ref<Resident[]>([]);
const loading = ref(false);
const statusFilter = ref('常住');

const showEdit = ref(false);
const editing = ref<Resident | null>(null);
const isCreate = ref(false);
const form = ref<Partial<Resident>>({});

const positions = ['住持', '知客', '维那', '典座', '僧值', '寮元', '衣钵', '书记', '汤药', '清众'];

const load = async () => {
  loading.value = true;
  try {
    list.value = await api<Resident[]>(`/residents?status=${encodeURIComponent(statusFilter.value)}`);
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const blank = (): Partial<Resident> => ({
  dharma_name: '', generation_name: '', tonsure_master: '',
  ordination_date: '', ordination_place: '', position: '清众',
  ordination_no: '', phone: '', karma_date: new Date().toISOString().slice(0, 10),
});

const openCreate = () => {
  isCreate.value = true;
  editing.value = null;
  form.value = blank();
  showEdit.value = true;
};

const openEdit = (row: Resident) => {
  isCreate.value = false;
  editing.value = row;
  form.value = { ...row };
  showEdit.value = true;
};

const save = async () => {
  if (!form.value.dharma_name) return;
  const r = isCreate.value
    ? await apiAction('录入常住', () => api('/residents', {
        method: 'POST',
        body: JSON.stringify({
          ...form.value,
          ordination_date: form.value.ordination_date || null,
          karma_date: form.value.karma_date || null,
        }),
      }))
    : await apiAction('保存档案', () => api(`/residents/${editing.value!.id}`, {
        method: 'PUT',
        body: JSON.stringify(form.value),
      }));
  if (r) {
    showEdit.value = false;
    load();
    emit('changed');
  }
};

const leave = async (row: Resident) => {
  const r = await apiAction(`办理 ${row.dharma_name} 退住`, () =>
    api(`/residents/${row.id}/leave`, { method: 'POST' }),
  );
  if (r) {
    load();
    emit('changed');
  }
};

const positionTagType: Record<string, 'primary' | 'info' | 'success' | 'warning' | 'default'> = {
  住持: 'warning',
  知客: 'primary',
  维那: 'info',
  典座: 'success',
  僧值: 'warning',
  寮元: 'default',
  衣钵: 'default',
  书记: 'default',
  汤药: 'default',
  清众: 'default',
};
</script>

<template>
  <n-card>
    <template #header>
      <n-radio-group v-model:value="statusFilter" button-style="solid" @update:value="load">
        <n-radio-button value="常住">常住</n-radio-button>
        <n-radio-button value="外出">外出</n-radio-button>
        <n-radio-button value="退住">退住</n-radio-button>
        <n-radio-button value="">全部</n-radio-button>
      </n-radio-group>
    </template>
    <template #header-extra>
      <n-button type="primary" size="small" @click="openCreate">＋ 直接录入常住</n-button>
    </template>

    <n-data-table
      :loading="loading"
      :data="list"
      :row-key="(r: Resident) => r.id"
      :bordered="false"
      :columns="[
        { title: '法名', key: 'dharma_name', width: 90,
          render: r => h('span', { style: 'font-weight:600' }, r.dharma_name) },
        { title: '字辈', key: 'generation_name', width: 90, render: r => r.generation_name ?? '—' },
        {
          title: '职务', key: 'position', width: 80,
          render: r => h(NTag, { type: positionTagType[r.position] ?? 'default', size: 'small' },
            { default: () => r.position }),
        },
        { title: '剃度师', key: 'tonsure_master', render: r => r.tonsure_master ?? '—' },
        { title: '受戒时间', key: 'ordination_date', width: 110, render: r => r.ordination_date ?? '—' },
        { title: '戒场', key: 'ordination_place', render: r => r.ordination_place ?? '—' },
        { title: '戒牒编号', key: 'ordination_no', width: 130, render: r => r.ordination_no ?? '—' },
        { title: '羯磨日期', key: 'karma_date', width: 110, render: r => r.karma_date ?? '—' },
        {
          title: '缺勤', key: 'absent_count', width: 80,
          render: r => r.absent_count >= 3
            ? h(NTag, { type: 'error', size: 'small' }, { default: () => `${r.absent_count} 次` })
            : r.absent_count
              ? h(NTag, { type: 'warning', size: 'small' }, { default: () => `${r.absent_count} 次` })
              : '—',
        },
        {
          title: '操作', key: 'op', width: 130,
          render: (row) => h(NSpace, { size: 4 }, {
            default: () => [
              h(NButton, { size: 'tiny', onClick: () => openEdit(row) }, { default: () => '编辑' }),
              row.status === '常住'
                ? h(NPopconfirm, { onPositiveClick: () => leave(row) }, {
                    trigger: () => h(NButton, { size: 'tiny', type: 'error', ghost: true }, { default: () => '退住' }),
                    default: () => `确认为 ${row.dharma_name} 办理退住？`,
                  })
                : null,
            ],
          }),
        },
      ]"
    />
  </n-card>

  <n-modal v-model:show="showEdit" preset="card" style="width: 620px"
    :title="isCreate ? '录入常住僧人' : `编辑常住档案 · ${editing?.dharma_name}`">
    <n-form label-placement="left" label-width="92px">
      <n-grid :cols="2" :x-gap="8">
        <n-gi><n-form-item label="法名" required>
          <n-input v-model:value="form.dharma_name" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="字辈/派字">
          <n-input v-model:value="form.generation_name" placeholder="如：隆字辈" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="剃度师">
          <n-input v-model:value="form.tonsure_master" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="担任职务">
          <n-select v-model:value="form.position"
            :options="positions.map(p => ({ label: p, value: p }))" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="受戒时间">
          <n-input v-model:value="form.ordination_date" placeholder="YYYY-MM-DD" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="戒场">
          <n-input v-model:value="form.ordination_place" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="戒牒编号">
          <n-input v-model:value="form.ordination_no" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="联系电话">
          <n-input v-model:value="form.phone" />
        </n-form-item></n-gi>
        <n-gi><n-form-item label="羯磨日期">
          <n-input v-model:value="form.karma_date" placeholder="YYYY-MM-DD" />
        </n-form-item></n-gi>
        <n-gi v-if="!isCreate"><n-form-item label="状态">
          <n-select v-model:value="form.status"
            :options="['常住','外出','退住'].map(s => ({ label: s, value: s }))" />
        </n-form-item></n-gi>
      </n-grid>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="showEdit = false">取消</n-button>
        <n-button type="primary" @click="save">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>
