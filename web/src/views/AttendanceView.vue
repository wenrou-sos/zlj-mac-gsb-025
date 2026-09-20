<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { api, apiAction } from '../api';
import type { Roster, RosterItem, AttendanceStatus, AbsenceAlert } from '../types';

const emit = defineEmits<{ changed: [] }>();
const message = useMessage();

const date = ref(new Date().toISOString().slice(0, 10));
const session = ref<'morning' | 'evening'>('morning');
const roster = ref<Roster | null>(null);
const loading = ref(false);
const saving = ref(false);
// person_key -> status 的本地编辑态
const marks = ref<Record<string, AttendanceStatus>>({});
const notes = ref<Record<string, string>>({});
const alerts = ref<AbsenceAlert[]>([]);

const keyOf = (r: RosterItem) => `${r.person_type}:${r.person_id}`;

const load = async () => {
  loading.value = true;
  try {
    roster.value = await api<Roster>(
      `/attendance/roster?date=${date.value}&session=${session.value}`,
    );
    marks.value = {};
    notes.value = {};
    for (const r of roster.value.roster) {
      if (r.status) marks.value[keyOf(r)] = r.status;
      if (r.note) notes.value[keyOf(r)] = r.note;
    }
    alerts.value = await api<AbsenceAlert[]>('/attendance/alerts');
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const absentCountOf = (r: RosterItem): number =>
  roster.value?.stats.find((s) => s.person_type === r.person_type && s.person_id === r.person_id)
    ?.absent_count ?? 0;

const stats = computed(() => {
  const vals = Object.values(marks.value);
  return {
    present: vals.filter((v) => v === 'present').length,
    absent: vals.filter((v) => v === 'absent').length,
    leave: vals.filter((v) => v === 'leave').length,
    unmarked: (roster.value?.roster.length ?? 0) - vals.length,
  };
});

const batchSet = (status: AttendanceStatus) => {
  if (!roster.value) return;
  for (const r of roster.value.roster) marks.value[keyOf(r)] = status;
};

const save = async () => {
  if (!roster.value) return;
  const records = Object.entries(marks.value).map(([k, status]) => {
    const [personType, idStr] = k.split(':');
    return {
      person_type: personType as RosterItem['person_type'],
      person_id: Number(idStr),
      status,
      note: notes.value[k] ?? null,
    };
  });
  saving.value = true;
  try {
    const r = await api<{ ok: true; alerts: AbsenceAlert[] }>('/attendance', {
      method: 'POST',
      body: JSON.stringify({ date: date.value, session: session.value, records }),
    });
    message.success(`已保存 ${records.length} 条考勤记录`);
    // 缺勤累计满 3 次 -> 自动提醒
    if (r.alerts.length) {
      for (const a of r.alerts) {
        message.warning(`⚠️ ${a.dharma_name} 缺勤累计已达 ${a.absent_count} 次，请客堂过问`, {
          duration: 6000,
        });
      }
    }
    await load();
    emit('changed');
  } catch (err) {
    message.error(`保存失败：${(err as Error).message}`);
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <n-space vertical :size="14">
    <n-card>
      <n-space align="center" justify="space-between">
        <n-space align="center">
          <n-text strong>课次</n-text>
          <n-radio-group v-model:value="session" button-style="solid" @update:value="load">
            <n-radio-button value="morning">🌅 早课</n-radio-button>
            <n-radio-button value="evening">🌆 晚课</n-radio-button>
          </n-radio-group>
          <n-input v-model:value="date" style="width: 160px" placeholder="YYYY-MM-DD" @blur="load" />
          <n-button @click="load">查询</n-button>
        </n-space>
        <n-space>
          <n-button size="small" @click="batchSet('present')">全部到</n-button>
          <n-button size="small" @click="batchSet('absent')">全部缺</n-button>
          <n-button size="small" type="primary" :loading="saving" @click="save">保存考勤</n-button>
        </n-space>
      </n-space>
      <n-divider style="margin: 12px 0" />
      <n-space>
        <n-tag type="success" size="small" round>到 {{ stats.present }}</n-tag>
        <n-tag type="error" size="small" round>缺 {{ stats.absent }}</n-tag>
        <n-tag type="warning" size="small" round>假 {{ stats.leave }}</n-tag>
        <n-tag size="small" round>未登记 {{ stats.unmarked }}</n-tag>
        <n-text depth="3" style="font-size: 12px">
          应到 {{ roster?.summary.total ?? 0 }} 人
        </n-text>
      </n-space>
    </n-card>

    <n-alert v-if="alerts.length" type="error" title="缺勤累计满 3 次 · 自动提醒">
      <n-space>
        <n-tag
          v-for="a in alerts"
          :key="a.person_type + a.person_id"
          type="error"
          size="small"
        >
          {{ a.dharma_name }}（{{ a.person_type === 'resident' ? '常住' : '挂单' }}）
          已缺勤 {{ a.absent_count }} 次
        </n-tag>
      </n-space>
    </n-alert>

    <n-card v-loading="loading">
      <n-empty v-if="roster && !roster.roster.length" description="当日在寺无人（先挂单或有常住）" />
      <n-table v-else :single-line="false">
        <thead>
          <tr>
            <th style="width: 60px">#</th>
            <th style="width: 100px">法名</th>
            <th>身份</th>
            <th style="width: 100px">累计缺勤</th>
            <th style="width: 280px">考勤</th>
            <th>备注（请假事由等）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in roster?.roster ?? []" :key="keyOf(r)">
            <td>{{ i + 1 }}</td>
            <td style="font-weight: 600">{{ r.dharma_name }}</td>
            <td>
              <n-tag size="small" :type="r.person_type === 'resident' ? 'info' : 'default'">
                {{ r.subtitle }}
              </n-tag>
            </td>
            <td>
              <n-tag
                v-if="absentCountOf(r) >= 3"
                type="error" size="small"
              >⚠️ {{ absentCountOf(r) }} 次</n-tag>
              <n-tag v-else-if="absentCountOf(r) > 0" type="warning" size="small">
                {{ absentCountOf(r) }} 次
              </n-tag>
              <span v-else style="color: #999">0</span>
            </td>
            <td>
              <n-radio-group v-model:value="marks[keyOf(r)]" size="small">
                <n-radio-button value="present">
                  <span style="color: #18a058">到</span>
                </n-radio-button>
                <n-radio-button value="absent">
                  <span style="color: #d03050">缺</span>
                </n-radio-button>
                <n-radio-button value="leave">
                  <span style="color: #f0a020">假</span>
                </n-radio-button>
              </n-radio-group>
            </td>
            <td>
              <n-input
                v-model:value="notes[keyOf(r)]"
                size="small"
                placeholder="如：告假下山看病"
                :bordered="true"
              />
            </td>
          </tr>
        </tbody>
      </n-table>
    </n-card>
  </n-space>
</template>
