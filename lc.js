const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 5000;
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'tiendat.json';
const HISTORY_FILE = 'tiendat1.json';
let predictionHistory = {
  hu: [],
  md5: []
};
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };
let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

// ✅ ========== NÂNG CẤP MỚI: TRẠNG THÁI CHIẾN LƯỢC CẦU RỒNG / BẮT KHUÔN ==========
let rongConsecutiveFail = { hu: 0, md5: 0 };       // Đếm chuỗi RỒNG SAI LIÊN TIẾP
let lastRongPrediction = { hu: null, md5: null };  // Lưu dự đoán Rồng vừa ra
let currentStrategy = { hu: 'NORMAL', md5: 'NORMAL' }; // NORMAL | RONG | BAT_KHUON_CHUAN
const RONG_FAIL_THRESHOLD = 3;                     // Sau 3 sai → chuyển bắt khuôn
const KHUON_RESET_AFTER_WIN = 2;                   // Thắng 2 → thử lại bình thường
let khuonWinStreak = { hu: 0, md5: 0 };
// ✅ ==============================================================================

// ==================== TRỌNG SỐ THUẬT TOÁN ĐƯỢC TỐI ƯU & NÂNG CẤP MẠNH ====================
const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 2.2,                  // Nâng cấp mạnh trọng số Cầu Bệt
  'cau_dao_11': 2.2,               // Nâng cấp mạnh trọng số Cầu Đảo 1-1
  'cau_rong': 2.8,                 // Nâng cấp tối đa trọng số Cầu Rồng
  'cau_22': 1.4,
  'cau_33': 1.4,
  'cau_121': 1.3,
  'cau_123': 1.4,
  'cau_321': 1.4,
  'cau_nhay_coc': 1.2,
  'cau_nhip_nghieng': 1.5,
  'cau_3van1': 1.3,
  'cau_be_cau': 1.6,
  'cau_chu_ky': 1.4,
  'distribution': 1.3,
  'dice_pattern': 1.3,
  'sum_trend': 1.5,
  'edge_cases': 1.4,
  'momentum': 1.6,
  'cau_tu_nhien': 1.0,
  'dice_trend_line': 1.3,
  'dice_trend_line_md5': 1.3,
  'break_pattern_hu': 1.4,
  'break_pattern_md5': 1.4,
  'fibonacci': 1.3,
  'resistance_support': 1.5,
  'wave': 1.4,
  'golden_ratio': 1.2,
  'day_gay': 1.4,
  'day_gay_md5': 1.4,
  'cau_44': 1.3,
  'cau_55': 1.4,
  'cau_212': 1.2,
  'cau_1221': 1.3,
  'cau_2112': 1.3,
  'cau_gap': 1.5,
  'cau_ziczac': 1.4,
  'cau_doi': 1.3,
  'smart_bet': 1.8,
  'break_pattern_advanced': 1.6,
  'break_streak': 1.7,
  'alternating_break': 1.6,
  'double_pair_break': 1.5,
  'triple_pattern': 1.5,
  'tong_phan_tich': 2.0,
  'xu_huong_manh': 1.9,
  'dao_chieu': 1.8,
  // ✅ ========== NÂNG CẤP MỚI: TRỌNG SỐ BẮT KHUÔN CHUẨN ==========
  'khuon_bet_chuan': 2.6,
  'khuon_11_chuan': 2.6,
  'khuon_22_chuan': 2.1,
  'khuon_212_chuan': 2.0,
  'khuon_121_chuan': 2.0,
  'rong_chuyen_khuon': 2.4
  // ✅ =============================================================
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded successfully from tiendat.json');
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}
function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}
function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      // ✅ Khôi phục trạng thái chiến lược nếu có lưu
      rongConsecutiveFail = parsed.rongConsecutiveFail || { hu:0, md5:0 };
      currentStrategy = parsed.currentStrategy || { hu:'NORMAL', md5:'NORMAL' };
      console.log('Prediction history loaded successfully from tiendat1.json');
      console.log(`  - Hu: ${predictionHistory.hu.length} records`);
      console.log(`  - MD5: ${predictionHistory.md5.length} records`);
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}
function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString(),
      // ✅ Lưu luôn trạng thái chiến lược
      rongConsecutiveFail,
      currentStrategy
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

// ✅ ========== NÂNG CẤP MỚI: HÀM THEO DÕI RỒNG SAI → CHUYỂN BẮT KHUÔN ==========
function trackRongResult(type, isCorrect) {
  if (lastRongPrediction[type] === null) return;
  if (isCorrect) {
    rongConsecutiveFail[type] = 0;
    if (currentStrategy[type] === 'BAT_KHUON_CHUAN') khuonWinStreak[type]++;
    if (khuonWinStreak[type] >= KHUON_RESET_AFTER_WIN) {
      currentStrategy[type] = 'NORMAL';
      khuonWinStreak[type] = 0;
      console.log(`[${type.toUpperCase()}] ✅ Khuôn thắng liên tiếp → TRỞ LẠI BÌNH THƯỜNG`);
    }
  } else {
    if (currentStrategy[type] === 'RONG' || lastRongPrediction[type]) {
      rongConsecutiveFail[type]++;
      console.log(`[${type.toUpperCase()}] ❌ Cầu Rồng SAI ${rongConsecutiveFail[type]}/${RONG_FAIL_THRESHOLD}`);
      if (rongConsecutiveFail[type] >= RONG_FAIL_THRESHOLD) {
        currentStrategy[type] = 'BAT_KHUON_CHUAN';
        khuonWinStreak[type] = 0;
        console.log(`[${type.toUpperCase()}] 🔄 RỒNG ${rongConsecutiveFail[type]} SAI → CHUYỂN BẮT KHUÔN CHUẨN (Bệt / 1-1 / 2-2 / 2-1-2 / 1-2-1)`);
      }
    }
  }
  lastRongPrediction[type] = null;
}
function isKhuonChuanMode(type) { return currentStrategy[type] === 'BAT_KHUON_CHUAN'; }
function khuonWeightBoost(type, baseWeight) {
  return isKhuonChuanMode(type) ? Math.min(3.8, baseWeight * 1.45) : baseWeight;
}
// ✅ ==============================================================================

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%) [${currentStrategy.hu}]`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) [${currentStrategy.md5}]`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Error processing predictions:', error.message);
  }
}
async function updateHistoryStatus(type) {
  try {
    let data = null;
    if (type === 'hu') {
      data = await fetchDataHu();
    } else {
      data = await fetchDataMd5();
    }
    
    if (!data || data.length === 0) return;
    
    let updated = false;
    for (const record of predictionHistory[type]) {
      if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
      
      // Tìm phiên dự đoán trong dữ liệu thực tế
      const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
      if (actualResult) {
        const duDoanNormalized = record.Du_doan;
        const ketQuaThucTe = actualResult.Ket_qua;
        
        if (duDoanNormalized === ketQuaThucTe) {
          record.ket_qua_du_doan = 'Đúng ✅';
        } else {
          record.ket_qua_du_doan = 'Sai ❌';
        }
        updated = true;
      }
    }
    
    if (updated) {
      savePredictionHistory();
    }
  } catch (error) {
    console.error(`Error updating ${type} history status:`, error.message);
  }
}
function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}
function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}
function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  let w = learningData[type].patternWeights[patternId] || 1.0;
  // ✅ NÂNG CẤP: chế độ bắt khuôn → TĂNG TRỌNG SỐ khuôn chuẩn
  if (isKhuonChuanMode(type) && ['cau_bet','cau_dao_11','cau_22','cau_212','cau_121'].includes(patternId)) {
    w = khuonWeightBoost(type, w);
  }
  return w;
}
function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  // === NÂNG CẤP: điều chỉnh trọng số chậm hơn, ổn định hơn ===
  if (stats.recentResults.length >= 7) {
    if (recentAccuracy > 0.70) {
      newWeight = Math.min(3.5, oldWeight * 1.08);
    } else if (recentAccuracy < 0.32) {
      newWeight = Math.max(0.3, oldWeight * 0.90);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}
function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  
  saveLearningData();
}
async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      // ✅ CẬP NHẬT KẾT QUẢ CẦU RỒNG
      if (pred.patterns && pred.patterns.some(p => String(p).includes('Cầu Rồng'))) {
        trackRongResult(type, pred.isCorrect);
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}
function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet',
    'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121',
    'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212',
    'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 1-2-1-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac',
    'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet',
    'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution',
    'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum',
    'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line',
    'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Cầu Liên Tục': 'break_pattern_hu',
    'MD5 Cầu': 'break_pattern_md5',
    'Dây Gãy': 'day_gay',
    'MD5 Dây Gãy': 'day_gay_md5',
    'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}
function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 12) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.72) return 12;
  if (accuracy > 0.62) return 8;
  if (accuracy > 0.52) return 4;
  if (accuracy < 0.32) return -12;
  if (accuracy < 0.42) return -7;
  
  return 0;
}
function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  // === NÂNG CẤP: đảo ngược chỉ khi thua liên tục RẤT MẠNH ===
  if (streakInfo.currentStreak <= -5) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 7) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += recentAcc * weight;
        } else {
          xiuPatternScore += recentAcc * weight;
        }
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.9) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  
  return prediction;
}
function normalizeResult(result) {
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
}
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) {
    return null;
  }
  
  return apiData.list.map(item => {
    const result = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
    return {
      Phien: item.id,
      Ket_qua: result,
      Xuc_xac_1: item.dices[0],
      Xuc_xac_2: item.dices[1],
      Xuc_xac_3: item.dices[2],
      Tong: item.point
    };
  });
}
async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}
async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return null;
  }
}
// ==================== CÁC HÀM PHÂN TÍCH NÂNG CẤP MẠNH THUẬT TOÁN ====================
function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.filter(r => r === 'Xỉu').length;
  
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (sumTrend > 1.8) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(80 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.8) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(80 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 4) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(75 + Math.abs(taiCount - xiuCount) * 3),
      name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}
function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  
  if (taiCount >= 7) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(85 + taiCount * 2),
      name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 1) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(85 + (8 - taiCount) * 2),
      name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}
function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  
  const recent5 = results.slice(0, 5);
  const weight = getPatternWeight(type, 'dao_chieu');
  
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) {
      isAlternating = false;
      break;
    }
  }
  
  if (isAlternating) {
    const prediction = recent5[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(80 * weight),
      name: `Đảo Chiều (Chuỗi ${recent5.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP MẠNH: CẦU BỆT — BẮT ĐÚNG, KHÔNG BẺ SỚM ====================
function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    let shouldBreak = false;
    let confidence = 70;
    // === NÂNG CẤP: LUÔN THEO CẦU, CHỈ BẺ KHI ĐẾN NGƯỠNG THẬT CAO ===
    if (streakLength === 3) {
      shouldBreak = false; confidence = 78;
    } else if (streakLength === 4) {
      shouldBreak = false; confidence = 82;
    } else if (streakLength === 5) {
      shouldBreak = false; confidence = 85;
    } else if (streakLength === 6) {
      shouldBreak = false; confidence = 87;
    } else if (streakLength >= 7 && streakLength <= 11) {
      shouldBreak = false; confidence = 89;
    } else if (streakLength >= 12 && streakLength <= 14) {
      shouldBreak = false; confidence = 86;
    } else if (streakLength >= 15) {
      shouldBreak = true;  confidence = 90;
    }
    
    const finalPrediction = shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType;
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: finalPrediction,
      confidence: Math.min(95, Math.round(confidence * (weight / 2))),
      name: `Cầu Bệt ${streakLength} phiên ${streakType} (${shouldBreak ? 'Cảnh báo Bẻ GẦN TỚI HẠN' : 'THEO CẦU — KHÔNG BẺ'})`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP MẠNH: CẦU ĐẢO 1‑1 — BÁM ĐÚNG KHUÔN ====================
function analyzeCauDao11(results, type) {
  if (results.length < 3) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 20); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 3) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    // === NÂNG CẤP: LUÔN THEO NHỊP ĐẢO, CHỈ NGHI NGỜ RẤT DÀI ===
    const nextPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    
    let baseConfidence = 74;
    if (alternatingLength === 3) baseConfidence = 74;
    else if (alternatingLength === 4) baseConfidence = 78;
    else if (alternatingLength >= 5 && alternatingLength <= 8) baseConfidence = 84;
    else if (alternatingLength >= 9 && alternatingLength <= 14) baseConfidence = 88;
    else if (alternatingLength >= 15) baseConfidence = 82;
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: nextPrediction,
      confidence: Math.min(94, Math.round(baseConfidence * (weight / 2))),
      name: `Cầu Đảo 1‑1 CHÍNH XÁC (${alternatingLength} phiên → ${nextPrediction} theo đúng khuôn)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP: CẦU 2‑2 — BẮT ĐÚNG CẶP XEN KẼ ====================
function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 5) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      // === NÂNG CẤP: theo đúng cặp kế tiếp ===
      const prediction = lastPairType === 'Tài' ? 'Xỉu' : 'Tài';
      
      return { 
        detected: true, 
        pairCount,
        prediction,
        confidence: Math.round(Math.min(84, 70 + pairCount * 3.5) * weight),
        name: `Cầu 2‑2 ĐÚNG KHUÔN (${pairCount} cặp → ${prediction})`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP: CẦU 3‑3 — BỘ BA XEN KẼ CHÍNH XÁC ====================
function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = i % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      // hết bộ ba → đảo
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      // đang trong bộ ba → theo
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(86, 72 + tripleCount * 4) * weight),
      name: `Cầu 3‑3 CHÍNH XÁC (${tripleCount} bộ ba, vị trí ${currentPosition}/3 → ${prediction})`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP: CẦU 1‑2‑1 — KHỚP ĐÚNG MẪU ====================
function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const p = results.slice(0, 4);
  // === NÂNG CẤP: khớp chính xác A‑B‑B‑A → tiếp theo = B ===
  if (p[0] !== p[1] && 
      p[1] === p[2] && 
      p[2] !== p[3] &&
      p[0] === p[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: p[1],
      confidence: Math.round(78 * weight),
      name: `Cầu 1‑2‑1 CHUẨN [${p.join('-')}] → ${p[1]}`,
      patternId: 'cau_121'
    };
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP: CẦU 2‑1‑2 — MỚI THÊM, ĐÚNG KHUÔN ====================
function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  
  const p = results.slice(0, 5);
  // Mẫu: A‑B‑A‑B‑A → kế tiếp = B  ||  B‑A‑B → kế tiếp A
  if (p[0] !== p[1] && p[1] !== p[2] && p[0] === p[2] &&
      p[2] !== p[3] && p[1] === p[3] &&
      p[3] !== p[4] && p[0] === p[4]) {
    const weight = getPatternWeight(type, 'cau_212');
    const prediction = p[1];
    return {
      detected: true,
      pattern: '2-1-2',
      prediction,
      confidence: Math.round(77 * weight),
      name: `Cầu 2‑1‑2 CHUẨN [${p.join('-')}] → ${prediction}`,
      patternId: 'cau_212'
    };
  }
  // Phiên bản ngắn: 4 phiên A‑B‑A‑B → theo khuôn
  if (results.length >= 4) {
    const s = results.slice(0, 4);
    if (s[0] !== s[1] && s[1] !== s[2] && s[0] === s[2] &&
        s[2] !== s[3] && s[1] === s[3]) {
      const weight = getPatternWeight(type, 'cau_212');
      const prediction = s[0];
      return {
        detected: true,
        pattern: '2-1-2 ngắn',
        prediction,
        confidence: Math.round(73 * weight),
        name: `Cầu 2‑1‑2 [${s.join('-')}] → ${prediction}`,
        patternId: 'cau_212'
      };
    }
  }
  
  return { detected: false };
}
function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(80 * weight),
        name: 'Cầu 1‑2‑3 CHUẨN',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}
function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(82 * weight),
      name: 'Cầu 3‑2‑1 CHUẨN',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}
function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 14); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 4).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 4),
        prediction: skipPattern[0],
        confidence: Math.round(76 * weight),
        name: 'Cầu Nhảy Cóc ĐÚNG NHỊP',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 4) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 4),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(73 * weight),
        name: 'Cầu Nhảy Cóc Đảo CHÍNH XÁC',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}
function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 === 5) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Tài',
      confidence: Math.round(80 * weight),
      name: `Cầu Nhịp Nghiêng (5/5 Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 === 0) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Xỉu',
      confidence: Math.round(80 * weight),
      name: `Cầu Nhịp Nghiêng (5/5 Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  return { detected: false };
}
function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  
  if (taiCount === 3) {
    return { 
      detected: true, 
      prediction: 'Xỉu',
      confidence: Math.round(75 * weight),
      name: 'Cầu 3 Ván 1 (3T‑1X) → Xỉu',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      prediction: 'Tài',
      confidence: Math.round(75 * weight),
      name: 'Cầu 3 Ván 1 (3X‑1T) → Tài',
      patternId: 'cau_3van1'
    };
  }
  
  return { detected: false };
}
function analyzeCauBeCau(results, type) {
  if (results.length < 10) return { detected: false };
  
  const recentStreak = analyzeCauBet(results, type);
  
  if (recentStreak.detected && recentStreak.length >= 5) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 5);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { 
        detected: true, 
        prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(83 * weight),
        name: 'Cầu Bẻ Cầu — chuẩn xác',
        patternId: 'cau_be_cau'
      };
    }
  }
  
  return { detected: false };
}
function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(60 * weight),
    name: 'Cầu Tự Nhiên (Theo Ván Trước)',
    patternId: 'cau_tu_nhien'
  };
}
// ==================== NÂNG CẤP: CẦU RỒNG — THEO ĐẾN KHI GẦN TỚI HẠN ====================
function analyzeCauRong(results, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    const dragonType = results[0];
    let confidence = 85;
    let prediction = dragonType;
    let modeText = 'Đu Cầu Rồng Tối Đa';
    
    if (streakLength >= 5 && streakLength <= 9) {
      prediction = dragonType; confidence = 90 + (streakLength - 5) * 1.5;
      modeText = `Bắt Rồng ${dragonType} ĐANG MẠNH — THEO`;
    } else if (streakLength >= 10 && streakLength <= 14) {
      prediction = dragonType; confidence = 93;
      modeText = `Cưỡi Siêu Rồng ${dragonType} — VẪN THEO`;
    } else if (streakLength >= 15 && streakLength <= 17) {
      prediction = dragonType; confidence = 86;
      modeText = `Rồng RẤT DÀI — cẩn trọng, vẫn theo`;
    } else if (streakLength >= 18) {
      prediction = dragonType === 'Tài' ? 'Xỉu' : 'Tài';
      confidence = 90;
      modeText = `CẢNH BÁO RỒNG NGỰỠNG TỚI HẠN → Đảo Bẻ`;
    }
    
    // ✅ LƯU DỰ ĐOÁN RỒNG ĐỂ THEO DÕI SAU NÀY
    const out = { 
      detected: true, 
      prediction: prediction,
      confidence: Math.min(96, Math.round(confidence * (weight / 2.2))),
      name: `Cầu Rồng ${streakLength} Phiên [${modeText}]`,
      patternId: 'cau_rong'
    };
    lastRongPrediction[type] = prediction;
    currentStrategy[type] = 'RONG';
    return out;
  }
  
  return { detected: false };
}
function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 === 5 && taiPrev5 <= 1) || (taiLast5 <= 0 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(85 * weight),
      name: `Đảo Xu Hướng MẠNH (${taiLast5}T‑${5-taiLast5}X → ${taiPrev5}T‑${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 9 || taiLast10 <= 1) {
    const dominant = taiLast10 >= 9 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(88 * weight),
      name: `Xu Hướng CỰC (${taiLast10}T‑${10-taiLast10}X) → Đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}
// ==================== NÂNG CẤP: BẺ CHUỖI — CHỈ KHI ĐÃ QUÁ DÀI ====================
function analyzeBreakStreak(results, type) {
  if (results.length < 7) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_streak') || 1.0;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  
  if (streakLength >= 9) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(88, 74 + streakLength) * weight),
      name: `Bẻ Chuỗi ${streakLength} phiên (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}
function analyzeAlternatingBreak(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'alternating_break') || 1.0;
  
  let alternatingCount = 0;
  for (let i = 0; i < Math.min(results.length, 18) - 1; i++) {
    if (results[i] !== results[i + 1]) alternatingCount++;
    else break;
  }
  
  if (alternatingCount >= 10) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(85, 72 + alternatingCount) * weight),
      name: `Bẻ Đảo ${alternatingCount} phiên → ${prediction}`,
      patternId: 'alternating_break'
    };
  }
  
  return { detected: false };
}
function analyzeDoublePairBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'double_pair_break') || 1.0;
  
  const isPair1 = results[0] === results[1];
  const isPair2 = results[2] === results[3];
  const isPair3 = results[4] === results[5];
  const isPair4 = results[6] === results[7];
  
  if (isPair1 && isPair2 && isPair3 && isPair4) {
    const pairType1 = results[0];
    const pairType2 = results[2];
    
    const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
    if (allSamePair) {
      const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(88 * weight),
        name: `4 CẶP CÙNG ${pairType1} → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
  }
  
  return { detected: false };
}
function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  
  const weight = getPatternWeight(type, 'triple_pattern') || 1.0;
  
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  
  if (isTriple1 && isTriple2 && isTriple3) {
    const t1 = results[0], t2 = results[3], t3 = results[6];
    
    if (t1 === t2 && t2 === t3) {
      const prediction = t1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(92 * weight),
        name: `3 BỘ BA CÙNG ${t1} → Bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
  }
  
  return { detected: false };
}
function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}
// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH — NÂNG CẤP ĐIỂM SỐ ====================
function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];

  // ✅ ========== NÂNG CẤP MỚI: NẾU RỒNG 3 SAI → BỎ RỒNG, ƯU TIÊN KHUÔN CHUẨN ==========
  const KHUON_MODE = isKhuonChuanMode(type);
  const PRIO_BET    = KHUON_MODE ? 30 : 20;
  const PRIO_11     = KHUON_MODE ? 30 : 20;
  const PRIO_22     = KHUON_MODE ? 28 : 16;
  const PRIO_212    = KHUON_MODE ? 27 : 17;
  const PRIO_121    = KHUON_MODE ? 26 : 15;
  // ✅ ==============================================================================
  
  // === NÂNG CẤP: THỨ TỰ ƯU TIÊN — KHUÔN CẦU CHÍNH XÁC ĐẦU TIÊN ===
  // ✅ CHỈ THÊM CẦU RỒNG NẾU CHƯA SAI 3 LIÊN TIẾP
  if (!KHUON_MODE) {
    const cauRong = analyzeCauRong(results, type);
    if (cauRong.detected) { predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 22, name: cauRong.name }); factors.push(cauRong.name); allPatterns.push(cauRong); }
  }
  
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) { predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: PRIO_BET, name: cauBet.name }); factors.push(cauBet.name); allPatterns.push(cauBet); }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) { predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: PRIO_11, name: cauDao11.name }); factors.push(cauDao11.name); allPatterns.push(cauDao11); }
  
  // === KHUÔN CẦU ĐÚNG MẪU ===
  const cau212 = analyzeCau212(results, type);
  if (cau212.detected) { predictions.push({ prediction: cau212.prediction, confidence: cau212.confidence, priority: PRIO_212, name: cau212.name }); factors.push(cau212.name); allPatterns.push(cau212); }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) { predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: PRIO_22, name: cau22.name }); factors.push(cau22.name); allPatterns.push(cau22); }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) { predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 16, name: cau33.name }); factors.push(cau33.name); allPatterns.push(cau33); }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) { predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: PRIO_121, name: cau121.name }); factors.push(cau121.name); allPatterns.push(cau121); }
  
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) { predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 14, name: cau123.name }); factors.push(cau123.name); allPatterns.push(cau123); }
  
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) { predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 14, name: cau321.name }); factors.push(cau321.name); allPatterns.push(cau321); }
  
  const tongPhanTich = analyzeTongPhanTich(last50, type);
  if (tongPhanTich.detected) { predictions.push({ prediction: tongPhanTich.prediction, confidence: tongPhanTich.confidence, priority: 13, name: tongPhanTich.name }); factors.push(tongPhanTich.name); allPatterns.push(tongPhanTich); }
  
  const xuHuongManh = analyzeXuHuongManh(results, type);
  if (xuHuongManh.detected) { predictions.push({ prediction: xuHuongManh.prediction, confidence: xuHuongManh.confidence, priority: 12, name: xuHuongManh.name }); factors.push(xuHuongManh.name); allPatterns.push(xuHuongManh); }
  
  const daoChieu = analyzeDaoChieu(results, type);
  if (daoChieu.detected) { predictions.push({ prediction: daoChieu.prediction, confidence: daoChieu.confidence, priority: 11, name: daoChieu.name }); factors.push(daoChieu.name); allPatterns.push(daoChieu); }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) { predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 10, name: cauBeCau.name }); factors.push(cauBeCau.name); allPatterns.push(cauBeCau); }
  
  const triplePattern = analyzeTriplePattern(results, type);
  if (triplePattern.detected) { predictions.push({ prediction: triplePattern.prediction, confidence: triplePattern.confidence, priority: 10, name: triplePattern.name }); factors.push(triplePattern.name); allPatterns.push(triplePattern); }
  
  const doublePairBreak = analyzeDoublePairBreak(results, type);
  if (doublePairBreak.detected) { predictions.push({ prediction: doublePairBreak.prediction, confidence: doublePairBreak.confidence, priority: 9, name: doublePairBreak.name }); factors.push(doublePairBreak.name); allPatterns.push(doublePairBreak); }
  
  const breakStreak = analyzeBreakStreak(results, type);
  if (breakStreak.detected) { predictions.push({ prediction: breakStreak.prediction, confidence: breakStreak.confidence, priority: 9, name: breakStreak.name }); factors.push(breakStreak.name); allPatterns.push(breakStreak); }
  
  const alternatingBreak = analyzeAlternatingBreak(results, type);
  if (alternatingBreak.detected) { predictions.push({ prediction: alternatingBreak.prediction, confidence: alternatingBreak.confidence, priority: 8, name: alternatingBreak.name }); factors.push(alternatingBreak.name); allPatterns.push(alternatingBreak); }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) { predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 8, name: smartBet.name }); factors.push(smartBet.name); allPatterns.push(smartBet); }
  
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) { predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name }); factors.push(cauNhipNghieng.name); allPatterns.push(cauNhipNghieng); }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) { predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name }); factors.push(cau3Van1.name); allPatterns.push(cau3Van1); }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) { predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name }); factors.push(cauNhayCoc.name); allPatterns.push(cauNhayCoc); }
  
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.18) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ prediction: minority, confidence: 70, priority: 4, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // === NÂNG CẤP: đảo chiều THÔNG MINH hơn khi thua ===
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -4) {
    if (taiScore > xiuScore) xiuScore *= 1.30;
    else taiScore *= 1.30;
  }
  // ✅ NÂNG CẤP: chế độ khuôn chuẩn → khuôn thắng → tăng điểm thêm
  if (KHUON_MODE) {
    if (khuonWinStreak[type] >= 1) {
      if (taiScore > xiuScore) taiScore *= 1.15; else xiuScore *= 1.15;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = KHUON_MODE ? 72 : 68;
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) baseConfidence += (p.confidence - 65) * 0.40;
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 14);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(65, Math.min(98, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    strategy: currentStrategy[type],
    rongFailStreak: rongConsecutiveFail[type],
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
}
// ==================== CẬP NHẬT ĐỔI TOÀN BỘ ID THÀNH @cskhvilong1 by vi long ====================
function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: '@cskhvilong1 by vi long',
    timestamp: new Date().toISOString(),
    // ✅ Lưu chiến lược vào lịch sử
    strategy: currentStrategy[type]
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}
// ==================== ENDPOINTS — GIỮ NGUYÊN 100% GIAO DIỆN ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('@cskhvilong1 by vi long — NÂNG CẤP v7.2 RỒNG→KHUÔN CHUẨN');
});
app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyPredictions('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => await updateHistoryStatus('hu'), 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: '@cskhvilong1 by vi long',
      chien_luoc: result.strategy,
      rong_sai_lien_tiep: result.rongFailStreak
    });
  } catch (e) { res.status(500).json({ error: 'Lỗi server' }); }
});
app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    
    await verifyPredictions('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => await updateHistoryStatus('md5'), 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: '@cskhvilong1 by vi long',
      chien_luoc: result.strategy,
      rong_sai_lien_tiep: result.rongFailStreak
    });
  } catch (e) { res.status(500).json({ error: 'Lỗi server' }); }
});
app.get('/lc79-hu/lichsu', async (req, res) => {
  try { await updateHistoryStatus('hu'); res.json({ type: 'Lẩu Cua 79 - Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length }); }
  catch { res.json({ type: 'Lẩu Cua 79 - Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length }); }
});
app.get('/lc79-md5/lichsu', async (req, res) => {
  try { await updateHistoryStatus('md5'); res.json({ type: 'Lẩu Cua 79 - MD5', history: predictionHistory.md5, total: predictionHistory.md5.length }); }
  catch { res.json({ type: 'Lẩu Cua 79 - MD5', history: predictionHistory.md5, total: predictionHistory.md5.length }); }
});
app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu(); if (!data) return res.status(500).json({ error: 'no data' });
    await verifyPredictions('hu', data);
    res.json(calculateAdvancedPrediction(data, 'hu'));
  } catch { res.status(500).json({ error: 'Lỗi server' }); }
});
app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5(); if (!data) return res.status(500).json({ error: 'no data' });
    await verifyPredictions('md5', data);
    res.json(calculateAdvancedPrediction(data, 'md5'));
  } catch { res.status(500).json({ error: 'Lỗi server' }); }
});
app.get('/lc79-hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'Hũ', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions, overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, strategy: currentStrategy.hu, rongFail: rongConsecutiveFail.hu });
});
app.get('/lc79-md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
  res.json({ type: 'MD5', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions, overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, strategy: currentStrategy.md5, rongFail: rongConsecutiveFail.md5 });
});
// ✅ ========== ENDPOINT MỚI: XEM / RESET CHIẾN LƯỢC ==========
app.get('/lc79-hu/strategy', (req, res) => res.json({ type:'Hũ', strategy:currentStrategy.hu, rongFailStreak:rongConsecutiveFail.hu, khuonWin:khuonWinStreak.hu }));
app.get('/lc79-md5/strategy', (req, res) => res.json({ type:'MD5', strategy:currentStrategy.md5, rongFailStreak:rongConsecutiveFail.md5, khuonWin:khuonWinStreak.md5 }));
app.get('/reset-strategy', (req, res) => {
  rongConsecutiveFail = { hu:0, md5:0 };
  currentStrategy = { hu:'NORMAL', md5:'NORMAL' };
  khuonWinStreak = { hu:0, md5:0 };
  lastRongPrediction = { hu:null, md5:null };
  savePredictionHistory();
  res.json({ ok:true, message:'✅ Đã reset chiến lược → BÌNH THƯỜNG' });
});
// ✅ =========================================================
app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions:[], patternStats:{}, totalPredictions:0, correctPredictions:0, patternWeights:{...DEFAULT_PATTERN_WEIGHTS}, lastUpdate:null, streakAnalysis:{wins:0,losses:0,currentStreak:0,bestStreak:0,worstStreak:0}, adaptiveThresholds:{}, recentAccuracy:[] },
    md5:{ predictions:[], patternStats:{}, totalPredictions:0, correctPredictions:0, patternWeights:{...DEFAULT_PATTERN_WEIGHTS}, lastUpdate:null, streakAnalysis:{wins:0,losses:0,currentStreak:0,bestStreak:0,worstStreak:0}, adaptiveThresholds:{}, recentAccuracy:[] }
  };
  saveLearningData();
  res.json({ ok: true, message: 'Đã reset dữ liệu học' });
});
loadLearningData();
loadPredictionHistory();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server: http://0.0.0.0:${PORT}`);
  console.log('Lẩu Cua 79 — Ultra Advanced Tai Xiu Engine v7.2 NÂNG CẤP RỒNG→KHUÔN');
  console.log('AUTHOR / ID: @vanminh2603 by Van minh');
  console.log('FILE: tiendat.json | tiendat1.json');
  console.log('CHIẾN LƯỢC: Bình thường → Cầu Rồng → [3 SAI] → BẮT KHUÔN CHUẨN → [2 THẮNG] → Bình thường');
  startAutoSaveTask();
});