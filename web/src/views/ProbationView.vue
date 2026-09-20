<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import { NButton, NSpace, NTag, NDataTable } from 'naive-ui';
import { api, apiAction } from '../api';
import type { Probation } from '../types';

const emit = defineEmits<{ changed: [] }>();
const list = ref<Probation[]>([]);
const loading = ref(false);
const tab = ref('考察中');

const showDecide = ref(false);
const target = ref<Probation | null>(null);
const result = ref<'通过' | '未通过'>('通过');
const form = ref({
  generation_name: '',
  tonsure_master: '',
  ordination_date: '',
  ordination_place: '',
  position: '清众',
  karma_date: new Date().toISOString().slice(0, 10),
  result_note: '',
});

const positions = ['住持', '知客', '维那', '典座', '僧值', '寮元', '衣钵', '书记', '汤药', '清众'];

const load = async () => {
  loading.value = true;
  try {
    list.value = await api<Probation[]>(`/probation?status=${encodeURIComponent(tab.value)}`);
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const openDecide = (row: Probation, r: '通过' | '未通过') => {
  target.value = row;
  result.value = r;
  form.value = {
    generation_name: '', tonsure_master: '', ordination_date: '',
    ordination_place: '', position: '清众',
    karma_date: new Date().toISOString().slice(0, 10),
    result_note: r === '通过' ? '考察期间道心坚固、威仪具足、随众出坡，同意羯磨成为常住。' : '',
  };
  showDecide.value = true;
};

const submit = async () => {
  const body: Record<string, unknown> = {
    result: result.value,
    result_note: form.value.result_note,
  };
  if (result.value === '通过') {
    Object.assign(body, {
      generation_name: form.value.generation_name,
      tonsure_master: form.value.tonsure_master,
      ordination_date: form.value.ordination_date || null,
      ordination_place: form.value.ordination_place,
      position: form.value.position,
      karma_date: form.value.karma_date,
    });
  }
  const r = await apiAction(
    result.value === '通过' ? '羯磨认定常住' : '考察评定',
    () => api(`/probation/${target.value!.id}/decide`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  if (r) {
    showDecide.value = false;
    load();
    emit('changed');
  }
};
</script>

<template>
  <n-card>
    <template #header>
      <n-radio-group v-model:value="tab" button-style="solid" @update:value="load">
        <n-radio-button value="考察中">考察中</n-radio-button>
        <n-radio-button value="通过">已通过（羯磨）</n-radio-button>
        <n-radio-button value="未通过">未通过</n-radio-button>
      </n-radio-group>
    </template>

    <n-alert type="info" :show-icon="true" style="margin-bottom: 12px">
      云游僧人挂单后发心常住，须经 <b>3–6 个月</b> 考察期；考察通过后经
      <b>羯磨仪式</b>（白二番/白四番）方成常住，录入常住档案。
    </n-alert>

    <n-data-table
      :loading="loading"
      :data="list"
      :row-key="(r: Probation) => r.id"
      :bordered="false"
      :columns="[
        { title: '法名', key: 'dharma_name', width: 90 },
        { title: '出家寺庙', key: 'home_monastery' },
        { title: '戒牒编号', key: 'ordination_no', width: 130 },
        { title: '考察起', key: 'start_date', width: 110 },
        { title: '考察止', key: 'end_date', width: 110 },
        {
          title: '剩余天数', key: 'days_left', width: 110,
          render: r => tab !== '考察中' ? '—'
            : h(NTag, { type: r.days_left < 0 ? 'error' : r.days_left <= 7 ? 'warning' : 'success', size: 'small' },
                { default: () => r.days_left < 0 ? `逾期 ${-r.days_left} 天` : `${r.days_left} 天` }),
        },
        {
          title: '状态', key: 'status', width: 100,
          render: r => h(NTag, {
            type: r.status === '通过' ? 'success' : r.status === '未通过' ? 'error' : 'warning',
            size: 'small',
          }, { default: () => r.status }),
        },
        { title: '考察评语', key: 'result_note', ellipsis: { tooltip: true }, render: r => r.result_note ?? '—' },
        {
          title: '羯磨办理', key: 'actions', width: 200,
          render: (row) => row.status !== '考察中' ? '—' : h(NSpace, { size: 6 }, {
            default: () => [
              h(NButton, { size: 'small', type: 'primary', onClick: () => openDecide(row, '通过') },
                { default: () => '通过 · 羯磨常住' }),
              h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => openDecide(row, '未通过') },
                { default: () => '未通过' }),
            ],
          }),
        },
      ]"
    />
  </n-card>

  <n-modal v-model:show="showDecide" preset="card" style="width: 580px"
    :title="result === '通过' ? '羯磨认定常住' : '考察未通过评定'">
    <template v-if="result === '通过'">
      <n-text depth="3" style="display: block; margin-bottom: 12px">
        为 <b>{{ target?.dharma_name }}</b> 办理羯磨后建立常住档案，请补录戒腊信息
      </n-text>
      <n-form label-placement="left" label-width="92px">
        <n-form-item label="字辈/派字">
          <n-input v-model:value="form.generation_name" placeholder="如：隆字辈" />
        </n-form-item>
        <n-form-item label="剃度师">
          <n-input v-model:value="form.tonsure_master" placeholder="如：上净下慧长老" />
        </n-form-item>
        <n-form-item label="受戒时间">
          <n-input v-model:value="form.ordination_date" placeholder="YYYY-MM-DD" />
        </n-form-item>
        <n-form-item label="戒场">
          <n-input v-model:value="form.ordination_place" placeholder="如：江西云居山真如寺" />
        </n-form-item>
        <n-form-item label="担任职务">
          <n-select
            v-model:value="form.position"
            :options="positions.map(p => ({ label: p, value: p }))"
          />
        </n-form-item>
        <n-form-item label="羯磨日期">
          <n-input v-model:value="form.karma_date" placeholder="YYYY-MM-DD" />
        </n-form-item>
        <n-form-item label="考察评语">
          <n-input v-model:value="form.result_note" type="textarea" :rows="2" />
        </n-form-item>
      </n-form>
    </template>
    <template v-else>
      <n-text depth="3" style="display: block; margin-bottom: 12px">
        <b>{{ target?.dharma_name }}</b> 考察未通过，可继续挂单或安排退单。
      </n-text>
      <n-input v-model:value="form.result_note" type="textarea" :rows="3" placeholder="请填写未通过原因" />
    </template>
    <template #footer>
      <n-space justify="end">
        <n-button @click="showDecide = false">取消</n-button>
        <n-button :type="result === '通过' ? 'primary' : 'error'" @click="submit">
          {{ result === '通过' ? '确认羯磨，录入常住' : '提交评定' }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>
