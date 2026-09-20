<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import { NButton, NSpace, NTag, NPopconfirm, NDataTable, useMessage } from 'naive-ui';
import { api, apiAction } from '../api';
import type { Room, Bed } from '../types';

const emit = defineEmits<{ changed: [] }>();
const message = useMessage();
const rooms = ref<Room[]>([]);
const beds = ref<Bed[]>([]);
const activeRoom = ref<Room | null>(null);
const loading = ref(false);
const showCreate = ref(false);
const form = ref({ room_no: '', building: '', remark: '', bed_count: 4 });

const load = async () => {
  loading.value = true;
  try {
    rooms.value = await api<Room[]>('/rooms');
    if (activeRoom.value) {
      activeRoom.value = rooms.value.find((r) => r.id === activeRoom.value!.id) ?? null;
      if (activeRoom.value) await loadBeds(activeRoom.value.id);
    }
  } finally {
    loading.value = false;
  }
};

const loadBeds = async (id: number) => {
  beds.value = await api<Bed[]>(`/rooms/${id}/beds`);
  activeRoom.value = rooms.value.find((r) => r.id === id) ?? null;
};

onMounted(load);

const createRoom = async () => {
  if (!form.value.room_no) return message.warning('请填写房间号');
  const r = await apiAction('新建寮房', () =>
    api('/rooms', { method: 'POST', body: JSON.stringify(form.value) }),
  );
  if (r) {
    showCreate.value = false;
    form.value = { room_no: '', building: '', remark: '', bed_count: 4 };
    load();
  }
};

const removeRoom = async (row: Room) => {
  const r = await apiAction(`删除 ${row.room_no}`, () =>
    api(`/rooms/${row.id}`, { method: 'DELETE' }),
  );
  if (r) {
    if (activeRoom.value?.id === row.id) {
      activeRoom.value = null;
      beds.value = [];
    }
    load();
  }
};
</script>

<template>
  <n-grid :cols="3" :x-gap="14" responsive="screen" item-responsive>
    <n-grid-item span="3 m:1">
      <n-card>
        <template #header>寮房一览</template>
        <template #header-extra>
          <n-button size="small" type="primary" @click="showCreate = true">＋ 新建寮房</n-button>
        </template>
        <n-data-table
          :loading="loading"
          :row-key="(r: Room) => r.id"
          :columns="[
            { title: '房间号', key: 'room_no' },
            { title: '楼栋/方位', key: 'building', render: r => r.building ?? '—' },
            {
              title: '床位', key: 'occ',
              render: r => h(NSpace, { align: 'center', size: 6 }, {
                default: () => [
                  h(NTag, { type: r.bed_used >= r.bed_total ? 'error' : 'success', size: 'small', round: true },
                    { default: () => `${r.bed_used}/${r.bed_total}` }),
                ],
              }),
            },
            {
              title: '操作', key: 'op', width: 130,
              render: (row) => h(NSpace, { size: 4 }, {
                default: () => [
                  h(NButton, { size: 'tiny', onClick: () => loadBeds(row.id) }, { default: () => '查看床位' }),
                  h(NPopconfirm, { onPositiveClick: () => removeRoom(row) }, {
                    trigger: () => h(NButton, { size: 'tiny', type: 'error', ghost: true }, { default: () => '删除' }),
                    default: () => '确定删除该寮房？',
                  }),
                ],
              }),
            },
          ]"
          :data="rooms"
          :bordered="false"
        />
      </n-card>
    </n-grid-item>

    <n-grid-item span="3 m:2">
      <n-card>
        <template #header>
          {{ activeRoom ? `${activeRoom.room_no} 床位明细` : '床位明细' }}
        </template>
        <template #header-extra>
          <n-tag v-if="activeRoom" :bordered="false">
            已住 {{ activeRoom.bed_used }} / {{ activeRoom.bed_total }}
          </n-tag>
        </template>

        <n-empty v-if="!activeRoom" description="点击左侧「查看床位」" style="padding: 60px 0" />
        <n-grid v-else :cols="2" :x-gap="10" :y-gap="10">
          <n-gi v-for="b in beds" :key="b.id">
            <n-card
              size="small"
              :bordered="true"
              :style="{ background: b.reg_id ? '#fff7f0' : '#f6ffed' }"
            >
              <n-space justify="space-between" align="center">
                <span style="font-weight: 600">{{ b.bed_no }}</span>
                <n-tag v-if="b.reg_id" type="warning" size="small">
                  {{ b.dharma_name }} 入住
                </n-tag>
                <n-tag v-else type="success" size="small">空闲</n-tag>
              </n-space>
            </n-card>
          </n-gi>
        </n-grid>
      </n-card>
    </n-grid-item>
  </n-grid>

  <n-modal v-model:show="showCreate" preset="card" title="新建寮房" style="width: 440px">
    <n-form label-placement="left" label-width="80px">
      <n-form-item label="房间号" required>
        <n-input v-model:value="form.room_no" placeholder="如：东单-103" />
      </n-form-item>
      <n-form-item label="楼栋/方位">
        <n-input v-model:value="form.building" placeholder="如：东单寮" />
      </n-form-item>
      <n-form-item label="床位数">
        <n-input-number v-model:value="form.bed_count" :min="1" :max="50" />
      </n-form-item>
      <n-form-item label="备注">
        <n-input v-model:value="form.remark" placeholder="如：云水堂" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="showCreate = false">取消</n-button>
        <n-button type="primary" @click="createRoom">创建</n-button>
      </n-space>
    </template>
  </n-modal>
</template>
