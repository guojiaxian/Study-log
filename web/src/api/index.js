import axios from 'axios';

const http = axios.create({ baseURL: '/api/v1', timeout: 60000 });

http.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body === 'object' && 'code' in body && body.code !== 0) {
      return Promise.reject(Object.assign(new Error(body.message || '请求失败'), { code: body.code, data: body.data }));
    }
    return body && typeof body === 'object' && 'code' in body ? body.data : body;
  },
  (err) => {
    const body = err.response?.data;
    if (body && typeof body === 'object' && 'code' in body) {
      return Promise.reject(Object.assign(new Error(body.message || '请求失败'), { code: body.code, data: body.data }));
    }
    return Promise.reject(new Error(err.message || '网络异常'));
  },
);

export default http;

/* ---------------- 业务接口 ---------------- */
export const api = {
  // 系统
  health: () => http.get('/health'),
  config: () => http.get('/config'),
  patchConfig: (p) => http.patch('/config', p),

  // 科目 / 类型
  /** 科目字典按学段区分；grade 不传则返回两个学段的并集 */
  subjects: (includeInactive = false, grade) => http.get('/subjects', { params: { includeInactive, grade } }),
  grades: () => http.get('/grades'),
  createSubject: (p) => http.post('/subjects', p),
  updateSubject: (id, p) => http.patch(`/subjects/${id}`, p),
  /** 删除需指定学段（仅删该学段的科目配置） */
  deleteSubject: (id, grade) => http.delete(`/subjects/${id}`, { params: { grade } }),
  examTypes: (includeInactive = false) => http.get('/exam-types', { params: { includeInactive } }),
  createExamType: (p) => http.post('/exam-types', p),
  updateExamType: (id, p) => http.patch(`/exam-types/${id}`, p),
  deleteExamType: (id) => http.delete(`/exam-types/${id}`),

  // 考试
  exams: (params) => http.get('/exams', { params }),
  exam: (id) => http.get(`/exams/${id}`),
  createExam: (p) => http.post('/exams', p),
  updateExam: (id, p) => http.patch(`/exams/${id}`, p),
  deleteExam: (id) => http.delete(`/exams/${id}`),

  // 统计
  overview: (params) => http.get('/stats/overview', { params }),
  trend: (params) => http.get('/stats/trend', { params }),
  rankTrend: (params) => http.get('/stats/rank-trend', { params }),
  compare: (examId, window) => http.get('/stats/compare', { params: { examId, window } }),
  matrix: (params) => http.get('/stats/matrix', { params }),

  // AI
  aiStatus: () => http.get('/ai/status'),
  parseScore: (p) => http.post('/ai/parse-score', p),
  commitParse: (p) => http.post('/ai/parse-score/commit', p),

  // 分析
  createReport: (p) => http.post('/analysis/reports', p),
  reports: (params) => http.get('/analysis/reports', { params }),
  report: (id) => http.get(`/analysis/reports/${id}`),
  deleteReport: (id) => http.delete(`/analysis/reports/${id}`),

  // 目标院校
  schools: () => http.get('/schools'),
  createSchool: (p) => http.post('/schools', p),
  updateSchool: (id, p) => http.patch(`/schools/${id}`, p),
  deleteSchool: (id) => http.delete(`/schools/${id}`),
  addAdmission: (schoolId, p) => http.post(`/schools/${schoolId}/scores`, p),
  updateAdmission: (schoolId, scoreId, p) => http.patch(`/schools/${schoolId}/scores/${scoreId}`, p),
  deleteAdmission: (schoolId, scoreId) => http.delete(`/schools/${schoolId}/scores/${scoreId}`),
  schoolsCompare: (params) => http.get('/schools/compare', { params }),

  // 数据
  exportUrl: (format = 'json') => `/api/v1/export?format=${format}`,
  importData: (backup) => http.post('/import', { backup }),
};
