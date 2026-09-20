// 与后端接口对应的类型定义

export type RegStatus = '挂单中' | '已退单' | '转常住';
export type Position =
  | '住持' | '知客' | '维那' | '典座' | '僧值'
  | '寮元' | '衣钵' | '书记' | '汤药' | '清众';
export type PersonType = 'registration' | 'resident';
export type AttendanceStatus = 'present' | 'absent' | 'leave';

export interface Registration {
  id: number;
  dharma_name: string;
  home_monastery: string;
  ordination_no: string;
  arrival_date: string;
  planned_stay_days: number;
  check_in_date: string | null;
  leave_date: string | null;
  phone: string | null;
  status: RegStatus;
  bed_id: number | null;
  room_no: string | null;
  bed_no: string | null;
  due_date: string;
  overdue_days: number;
  absent_count: number;
}

export interface Room {
  id: number;
  room_no: string;
  building: string | null;
  remark: string | null;
  bed_total: number;
  bed_used: number;
}

export interface Bed {
  id: number;
  bed_no: string;
  reg_id: number | null;
  dharma_name: string | null;
  occupant_status: string | null;
}

export interface AvailableBed {
  id: number;
  bed_no: string;
  room_id: number;
  room_no: string;
}

export interface Probation {
  id: number;
  registration_id: number;
  start_date: string;
  end_date: string;
  days_left: number;
  status: '考察中' | '通过' | '未通过';
  result_note: string | null;
  dharma_name: string;
  home_monastery: string;
  ordination_no: string;
}

export interface Resident {
  id: number;
  dharma_name: string;
  generation_name: string | null;
  tonsure_master: string | null;
  ordination_date: string | null;
  ordination_place: string | null;
  position: Position;
  ordination_no: string | null;
  phone: string | null;
  status: '常住' | '外出' | '退住';
  karma_date: string | null;
  absent_count: number;
}

export interface RosterItem {
  person_type: PersonType;
  person_id: number;
  dharma_name: string;
  subtitle: string;
  status: AttendanceStatus | null;
  note: string | null;
}

export interface Roster {
  date: string;
  session: 'morning' | 'evening';
  roster: RosterItem[];
  stats: Array<{ person_type: PersonType; person_id: number; absent_count: number }>;
  summary: { total: number; marked: number; absent: number };
}

export interface AbsenceAlert {
  person_type: PersonType;
  person_id: number;
  dharma_name: string;
  absent_count: number;
  last_absent_date: string;
}

export interface OverdueItem {
  id: number;
  dharma_name: string;
  arrival_date: string;
  planned_stay_days: number;
  due_date: string;
  overdue_days: number;
}

export interface ProbationDueItem {
  id: number;
  registration_id: number;
  dharma_name: string;
  start_date: string;
  end_date: string;
  days_left: number;
}

export interface Dashboard {
  stats: {
    active_guests: number;
    on_probation: number;
    residents: number;
    beds_total: number;
    beds_used: number;
  };
  absenceAlerts: AbsenceAlert[];
  overdue: OverdueItem[];
  probationDue: ProbationDueItem[];
  occupancy: Array<{ room_no: string; total: number; used: number }>;
}
