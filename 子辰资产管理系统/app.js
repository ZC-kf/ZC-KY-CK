class AssetDatabase {
    constructor() {
        this.dbName = 'ZichenAssetDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('assets')) {
                    db.createObjectStore('assets', { keyPath: 'id', autoIncrement: true });
                }
                
                if (!db.objectStoreNames.contains('completedDepartments')) {
                    db.createObjectStore('completedDepartments', { keyPath: 'departmentName' });
                }
                
                if (!db.objectStoreNames.contains('photos')) {
                    const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                    photoStore.createIndex('assetId', 'assetId', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('appState')) {
                    db.createObjectStore('appState', { keyPath: 'key' });
                }
            };
        });
    }

    async saveAssets(assets) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['assets'], 'readwrite');
            const store = transaction.objectStore('assets');
            
            store.clear();
            
            assets.forEach((asset, index) => {
                store.add({ ...asset, id: index + 1 });
            });
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getAssets() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['assets'], 'readonly');
            const store = transaction.objectStore('assets');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result.map(a => ({ ...a, id: undefined })));
            request.onerror = () => reject(request.error);
        });
    }

    async saveCompletedDepartment(departmentName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['completedDepartments'], 'readwrite');
            const store = transaction.objectStore('completedDepartments');
            const request = store.put({ departmentName, ...data });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAllCompletedDepartments() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['completedDepartments'], 'readonly');
            const store = transaction.objectStore('completedDepartments');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const map = new Map();
                request.result.forEach(item => {
                    const { departmentName, ...data } = item;
                    map.set(departmentName, data);
                });
                resolve(map);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearCompletedDepartments() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['completedDepartments'], 'readwrite');
            const store = transaction.objectStore('completedDepartments');
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async saveAppState(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['appState'], 'readwrite');
            const store = transaction.objectStore('appState');
            const request = store.put({ key, value, timestamp: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAppState(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['appState'], 'readonly');
            const store = transaction.objectStore('appState');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    }

    async clearAllData() {
        return new Promise((resolve, reject) => {
            const stores = ['assets', 'completedDepartments', 'photos', 'appState'];
            let completed = 0;
            
            stores.forEach(storeName => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === stores.length) resolve();
                };
                request.onerror = () => reject(request.error);
            });
        });
    }

    async exportAllData() {
        const assets = await this.getAssets();
        const completedDepartments = await this.getAllCompletedDepartments();
        
        return {
            assets,
            completedDepartments: Array.from(completedDepartments.entries()),
            timestamp: new Date().toISOString(),
            version: '2.0'
        };
    }

    async importAllData(data) {
        if (data.assets) {
            await this.saveAssets(data.assets);
        }
        
        if (data.completedDepartments) {
            await this.clearCompletedDepartments();
            for (const [deptName, deptData] of data.completedDepartments) {
                await this.saveCompletedDepartment(deptName, deptData);
            }
        }
        
        await this.saveAppState('lastImport', Date.now());
    }
}

class AssetManagementSystem {
    constructor() {
        this.assets = [];
        this.departments = new Map();
        this.completedDepartments = new Map();
        this.pendingAssets = [];
        this.currentDepartment = null;
        this.currentAsset = null;
        this.cornerPhotos = {};
        this.selectedAssetIndices = new Set();
        this.lastScreen = null;
        this.lastDepartment = null;
        this.db = new AssetDatabase();
        this.isInitialized = false;
        this.init();
    }

    async init() {
        try {
            console.log('=== 子辰资产管理系统初始化 ===');
            
            await this.db.init();
            console.log('IndexedDB数据库初始化成功');
            
            await this.verifyAndLoadData();
            this.bindEvents();
            
            if (this.lastScreen && this.lastScreen !== 'main' && this.assets.length > 0) {
                console.log('恢复上次状态:', this.lastScreen, this.lastDepartment);
                this.renderMainScreen();
                
                if (this.lastScreen === 'department' && this.lastDepartment) {
                    this.openDepartment(this.lastDepartment);
                } else if (this.lastScreen === 'legacy') {
                    this.showLegacyScreen();
                } else {
                    this.renderMainScreen();
                }
            } else {
                this.renderMainScreen();
            }
            
            this.setupAutoSave();
            this.setupPageVisibilitySave();
            this.isInitialized = true;
            
            console.log('=== 系统初始化完成 ===');
        } catch (error) {
            console.error('初始化失败:', error);
            this.showModal('初始化失败', '系统初始化失败，请刷新页面重试');
        }
    }

    setupAutoSave() {
        window.addEventListener('beforeunload', async () => {
            console.log('页面即将卸载，自动保存数据...');
            await this.saveData();
        });

        setInterval(async () => {
            if (this.isInitialized && (this.assets.length > 0 || this.completedDepartments.size > 0)) {
                await this.saveData();
            }
        }, 60000);
    }

    setupPageVisibilitySave() {
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden && this.isInitialized) {
                console.log('页面隐藏，自动保存数据...');
                await this.saveData();
            }
        });
    }

    async verifyAndLoadData() {
        try {
            console.log('开始数据验证和加载...');
            
            const dbAssets = await this.db.getAssets();
            const dbCompleted = await this.db.getAllCompletedDepartments();
            
            if (dbAssets && dbAssets.length > 0) {
                this.assets = dbAssets;
                console.log('资产数据从IndexedDB加载成功，条数:', this.assets.length);
                this.groupByDepartment();
            } else {
                const lsAssets = localStorage.getItem('assets');
                if (lsAssets) {
                    try {
                        this.assets = JSON.parse(lsAssets);
                        console.log('从localStorage迁移资产数据到IndexedDB');
                        await this.db.saveAssets(this.assets);
                        this.groupByDepartment();
                    } catch (e) {
                        console.warn('localStorage资产数据解析失败');
                    }
                }
            }
            
            if (dbCompleted && dbCompleted.size > 0) {
                this.completedDepartments = dbCompleted;
                console.log('已完成科室从IndexedDB加载成功，数量:', this.completedDepartments.size);
            } else {
                const lsCompleted = localStorage.getItem('completedDepartments');
                if (lsCompleted) {
                    try {
                        const completedArray = JSON.parse(lsCompleted);
                        this.completedDepartments = new Map(completedArray);
                        console.log('从localStorage迁移已完成科室到IndexedDB');
                        for (const [deptName, deptData] of this.completedDepartments) {
                            await this.db.saveCompletedDepartment(deptName, deptData);
                        }
                    } catch (e) {
                        console.warn('localStorage已完成科室数据解析失败');
                    }
                }
            }
            
            this.lastScreen = await this.db.getAppState('lastScreen');
            this.lastDepartment = await this.db.getAppState('lastDepartment');
            
            if (!this.lastScreen) {
                this.lastScreen = localStorage.getItem('lastScreen');
            }
            if (!this.lastDepartment) {
                const lsLastDept = localStorage.getItem('lastDepartment');
                if (lsLastDept) {
                    this.lastDepartment = JSON.parse(lsLastDept);
                }
            }
            
            console.log('数据验证和加载完成');
            
            if (this.assets.length > 0 || this.completedDepartments.size > 0) {
                console.log(`数据状态 - 资产:${this.assets.length}, 科室:${this.completedDepartments.size}`);
            }
        } catch (error) {
            console.error('数据验证和加载失败:', error);
            this.showModal('数据加载警告', '数据加载可能有问题，请尝试恢复备份');
        }
    }

    async saveData() {
        try {
            console.log('开始保存数据到IndexedDB...');
            
            await this.db.saveAssets(this.assets);
            
            await this.db.clearCompletedDepartments();
            for (const [deptName, deptData] of this.completedDepartments) {
                await this.db.saveCompletedDepartment(deptName, deptData);
            }
            
            const currentScreen = document.querySelector('.screen.active')?.id.replace('-screen', '') || 'main';
            await this.db.saveAppState('lastScreen', currentScreen);
            await this.db.saveAppState('lastDepartment', this.currentDepartment);
            await this.db.saveAppState('lastSaveTime', Date.now());
            
            localStorage.setItem('assets', JSON.stringify(this.assets));
            localStorage.setItem('completedDepartments', JSON.stringify(Array.from(this.completedDepartments.entries())));
            localStorage.setItem('lastScreen', currentScreen);
            localStorage.setItem('lastDepartment', JSON.stringify(this.currentDepartment));
            
            console.log('数据保存成功');
        } catch (error) {
            console.error('保存数据失败:', error);
            this.showModal('保存失败', '数据保存失败，请检查浏览器存储空间');
        }
    }

    async backupData() {
        if (this.assets.length === 0 && this.completedDepartments.size === 0) {
            this.showModal('提示', '暂无数据可备份');
            return;
        }

        try {
            const backupData = await this.db.exportAllData();
            const dataStr = JSON.stringify(backupData, null, 2);
            const fileName = 'zichen_asset_backup_' + new Date().toISOString().slice(0, 10) + '_' + new Date().getTime() + '.json';
            
            this.downloadFile(dataStr, fileName, 'application/json');
            this.showBackupSuccessModal();
        } catch (error) {
            console.error('备份失败:', error);
            this.showModal('备份失败', '数据备份失败，请重试');
        }
    }

    downloadFile(content, fileName, mimeType) {
        console.log('开始下载文件:', fileName);
        
        try {
            const blob = new Blob([content], { type: mimeType });
            
            if (window.navigator && window.navigator.msSaveOrOpenBlob) {
                window.navigator.msSaveOrOpenBlob(blob, fileName);
                this.showDownloadSuccessModal(fileName);
                return;
            }
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            this.showDownloadSuccessModal(fileName);
        } catch (error) {
            console.error('下载文件失败:', error);
            this.showDownloadAlternativeModal(content, fileName, mimeType);
        }
    }
    
    showDownloadSuccessModal(fileName) {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 60px; margin-bottom: 15px;">✅</div>
                <h3 style="color: #28a745; margin-bottom: 20px;">文件下载成功！</h3>
            </div>
            <div style="background: #e8f5e9; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
                <p style="margin: 0; font-weight: bold; color: #155724;">📁 文件名：</p>
                <p style="margin: 5px 0 0 0; color: #2e7d32;">${fileName}</p>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 10px;">
                <p style="margin: 0; font-weight: bold; color: #856404;">💡 查找文件：</p>
                <ul style="margin: 10px 0 0 20px; color: #856404; font-size: 14px;">
                    <li>电脑：查看浏览器下载文件夹</li>
                    <li>手机：查看「下载」或「Download」文件夹</li>
                </ul>
            </div>
        `;
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.hideModal()">知道了</button>';
        this.showModalRaw();
    }
    
    showDownloadAlternativeModal(content, fileName, mimeType) {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        let isText = mimeType.includes('text') || mimeType.includes('json');
        
        let html = `
            <div style="text-align: center;">
                <div style="font-size: 60px; margin-bottom: 15px;">⚠️</div>
                <h3 style="color: #ff9800; margin-bottom: 20px;">自动下载遇到问题</h3>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 10px;">
                <p style="margin: 0; font-weight: bold; color: #856404;">💡 请尝试以下方法：</p>
                <ul style="margin: 10px 0 0 20px; color: #856404; font-size: 14px;">
                    <li>检查浏览器是否阻止了下载</li>
                    <li>尝试使用Chrome、Edge等现代浏览器</li>
                </ul>
            </div>
        `;
        
        if (isText) {
            html += `
                <div style="background: #e3f2fd; padding: 15px; border-radius: 10px; margin-top: 15px;">
                    <p style="margin: 0; font-weight: bold; color: #1565c0;">📋 手动保存文本内容：</p>
                    <textarea id="backup-content" style="width: 100%; height: 200px; margin-top: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 12px;">${typeof content === 'string' ? content.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</textarea>
                    <p style="margin-top: 10px; font-size: 12px; color: #666;">复制全部内容后，新建文本文件粘贴保存</p>
                </div>
            `;
        }
        
        modalBody.innerHTML = html;
        modalActions.innerHTML = '<button class="modal-btn secondary" onclick="app.hideModal()">关闭</button>';
        this.showModalRaw();
    }

    showBackupSuccessModal() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 60px; margin-bottom: 15px;">✅</div>
                <h3 style="color: #28a745; margin-bottom: 20px;">备份成功！</h3>
            </div>
            <div style="background: #e8f5e9; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
                <p style="margin: 0; font-weight: bold; color: #155724;">📁 文件已保存到下载文件夹</p>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 10px;">
                <p style="margin: 0; font-weight: bold; color: #856404;">💡 使用提示：</p>
                <ul style="margin: 10px 0 0 20px; color: #856404; font-size: 14px;">
                    <li>备份文件包含所有数据，可以随时恢复</li>
                    <li>建议定期备份，避免数据丢失</li>
                </ul>
            </div>
        `;
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.hideModal()">知道了</button>';
        this.showModalRaw();
    }

    async viewStoredData() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        const assetsCount = this.assets.length;
        const completedCount = this.completedDepartments.size;
        const totalPhotos = this.countTotalPhotos();
        const lastSaveTime = await this.db.getAppState('lastSaveTime');
        const lastSaveStr = lastSaveTime ? new Date(parseInt(lastSaveTime)).toLocaleString('zh-CN') : '从未保存';
        
        modalBody.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 50px; margin-bottom: 10px;">📊</div>
                <h3 style="color: #667eea; margin: 0;">数据存储状态</h3>
            </div>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 10px;">
                <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef;">
                    <span style="color: #495057;">资产记录总数:</span>
                    <span style="font-weight: bold; color: #667eea;">${assetsCount}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef;">
                    <span style="color: #495057;">已完成科室:</span>
                    <span style="font-weight: bold; color: #28a745;">${completedCount}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef;">
                    <span style="color: #495057;">照片总数:</span>
                    <span style="font-weight: bold; color: #ff9800;">${totalPhotos}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 10px 0;">
                    <span style="color: #495057;">最后保存时间:</span>
                    <span style="font-weight: bold; color: #6c757d;">${lastSaveStr}</span>
                </div>
            </div>
            <div style="margin-top: 20px; padding: 15px; background: #d4edda; border-radius: 10px;">
                <p style="margin: 0; color: #155724; font-size: 14px;">
                    ✅ <strong>数据安全状态：</strong>
                </p>
                <ul style="margin: 10px 0 0 20px; color: #155724; font-size: 13px;">
                    <li>使用IndexedDB内置数据库存储</li>
                    <li>同时备份到localStorage双重保障</li>
                    <li>刷新、关闭页面、重新打开都不会丢失数据</li>
                    <li>每1分钟自动保存一次</li>
                </ul>
            </div>
        `;
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.hideModal()">确定</button>';
        this.showModalRaw();
    }
    
    countTotalPhotos() {
        let count = 0;
        this.completedDepartments.forEach((data) => {
            if (data.cornerPhotos) count += data.cornerPhotos.length;
            data.assets.forEach((asset) => {
                if (asset.photos) count += asset.photos.length;
            });
        });
        return count;
    }
    
    async clearAllData() {
        if (!confirm('确定要清除所有数据吗？此操作不可恢复！\n\n建议先点击"备份数据"保存备份！')) {
            return;
        }

        try {
            await this.db.clearAllData();
            
            localStorage.removeItem('assets');
            localStorage.removeItem('completedDepartments');
            
            this.assets = [];
            this.departments.clear();
            this.completedDepartments.clear();
            this.renderMainScreen();
            this.showModal('已清除', '所有数据已清除');
        } catch (error) {
            console.error('清除数据失败:', error);
            this.showModal('清除失败', '数据清除失败，请重试');
        }
    }

    groupByDepartment() {
        this.departments.clear();
        this.assets.forEach(asset => {
            const dept = asset['使用部门'] || '未分类';
            if (!this.departments.has(dept)) {
                this.departments.set(dept, []);
            }
            this.departments.get(dept).push(asset);
        });
    }

    bindEvents() {
        const btnBackup = document.getElementById('btn-backup');
        const btnClearData = document.getElementById('btn-clear-data');
        const btnViewData = document.getElementById('btn-view-data');
        
        if (btnBackup) {
            btnBackup.onclick = () => this.backupData();
        }
        
        if (btnClearData) {
            btnClearData.onclick = () => this.clearAllData();
        }
        
        if (btnViewData) {
            btnViewData.onclick = () => this.viewStoredData();
        }

        document.getElementById('excel-import').addEventListener('change', (e) => this.importExcel(e));
        document.getElementById('backup-import').addEventListener('change', (e) => this.importBackup(e));
        document.getElementById('btn-back-from-dept').addEventListener('click', () => this.showScreen('main'));
        document.getElementById('btn-back-from-pending').addEventListener('click', () => this.showScreen('department'));
        document.getElementById('btn-back-from-legacy').addEventListener('click', () => this.showScreen('main'));
        document.getElementById('btn-legacy').addEventListener('click', () => this.showLegacyScreen());
        document.getElementById('btn-register-complete').addEventListener('click', () => this.goToPending());
        document.getElementById('btn-complete-all').addEventListener('click', () => this.completeRegistration());
        document.getElementById('btn-export-all').addEventListener('click', () => this.exportAll());
        document.getElementById('modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.hideModal();
        });
    }

    async importExcel(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (this.assets.length > 0 || this.completedDepartments.size > 0) {
            if (!confirm('检测到浏览器中已有数据，导入新Excel将覆盖当前数据！\n\n建议先点击"备份数据"保存备份！\n\n确定要继续吗？')) {
                event.target.value = '';
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                this.assets = XLSX.utils.sheet_to_json(worksheet);
                this.groupByDepartment();
                this.completedDepartments.clear();
                
                await this.saveData();
                this.renderMainScreen();
                this.showModal('导入成功', '成功导入 ' + this.assets.length + ' 条资产记录，' + this.departments.size + ' 个科室。\n\n数据已自动保存！');
            } catch (error) {
                this.showModal('导入失败', '无法解析Excel文件，请确保格式正确。');
            }
            event.target.value = '';
        };
        reader.readAsArrayBuffer(file);
    }

    async importBackup(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (this.assets.length > 0 || this.completedDepartments.size > 0) {
            if (!confirm('检测到浏览器中已有数据，导入备份将覆盖当前数据！\n\n确定要继续吗？')) {
                event.target.value = '';
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backupData = JSON.parse(e.target.result);
                
                if (!backupData.assets || !backupData.completedDepartments) {
                    this.showModal('导入失败', '备份文件格式不正确');
                    event.target.value = '';
                    return;
                }

                this.assets = backupData.assets;
                
                if (Array.isArray(backupData.completedDepartments)) {
                    this.completedDepartments = new Map(backupData.completedDepartments);
                } else if (typeof backupData.completedDepartments === 'object') {
                    this.completedDepartments = new Map(Object.entries(backupData.completedDepartments));
                }
                
                this.groupByDepartment();
                await this.saveData();
                this.renderMainScreen();
                
                let message = '备份数据恢复成功！\n\n';
                message += '资产记录: ' + this.assets.length + ' 条\n';
                message += '已完成科室: ' + this.completedDepartments.size + ' 个';
                
                this.showModal('恢复成功', message);
            } catch (error) {
                console.error('导入备份失败:', error);
                this.showModal('导入失败', '无法解析备份文件，请确认文件格式正确。');
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    renderMainScreen() {
        console.log('渲染主界面...');
        
        const importSection = document.getElementById('import-section');
        const departmentsSection = document.getElementById('departments-section');
        const departmentsList = document.getElementById('departments-list');

        if (this.assets.length === 0) {
            importSection.style.display = 'block';
            departmentsSection.style.display = 'none';
        } else {
            importSection.style.display = 'none';
            departmentsSection.style.display = 'block';
            
            departmentsList.innerHTML = '';
            this.departments.forEach((assets, deptName) => {
                const isCompleted = this.completedDepartments.has(deptName);
                
                const div = document.createElement('div');
                div.className = 'department-item';
                div.innerHTML = '<div class="department-header"><span class="department-name">' + deptName + '</span><span class="status-badge ' + (isCompleted ? 'green' : 'red') + '">' + (isCompleted ? '完成登记' : '未完成登记') + '</span></div><p style="margin-top: 10px; color: #666; font-size: 13px;">资产数量: ' + assets.length + '</p>';
                div.addEventListener('click', () => this.openDepartment(deptName));
                departmentsList.appendChild(div);
            });
        }
    }

    openDepartment(deptName) {
        this.currentDepartment = deptName;
        this.pendingAssets = [];
        this.selectedAssetIndices = new Set();
        document.getElementById('dept-title').textContent = deptName;
        this.renderDepartmentAssets();
        this.showScreen('department');
    }

    renderDepartmentAssets() {
        const assetsList = document.getElementById('assets-list');
        const assets = this.departments.get(this.currentDepartment) || [];
        
        assetsList.innerHTML = '';
        assets.forEach((asset, index) => {
            const div = document.createElement('div');
            const isSelected = this.selectedAssetIndices && this.selectedAssetIndices.has(index);
            
            div.className = 'asset-item' + (isSelected ? ' selected' : '');
            div.innerHTML = '<div class="asset-info"><div class="asset-name">' + (asset['资产名称'] || '未命名') + (isSelected ? ' <span style="color: #155724; font-size: 14px;">✓ 已选择</span>' : '') + '</div><div class="asset-detail"><span>编号: ' + (asset['资产编号'] || '-') + '</span><span>规格: ' + (asset['规格型号'] || '-') + '</span><span>原值: ' + (asset['资产原值'] || '-') + '</span></div><div class="asset-detail"><span>使用人: ' + (asset['使用人'] || '-') + '</span><span>购置日期: ' + (asset['购置日期'] || '-') + '</span></div></div>';
            div.addEventListener('click', () => this.showRegisterModal(asset, index));
            assetsList.appendChild(div);
        });
    }

    showRegisterModal(asset, index) {
        this.currentAsset = { ...asset, _index: index };
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">' + asset['资产名称'] + '</h3><p><strong>编号:</strong> ' + (asset['资产编号'] || '-') + '</p><p><strong>规格:</strong> ' + (asset['规格型号'] || '-') + '</p><p><strong>原值:</strong> ' + (asset['资产原值'] || '-') + '</p><p><strong>使用人:</strong> ' + (asset['使用人'] || '-') + '</p>';
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.registerAsset()">登记</button><button class="modal-btn secondary" onclick="app.hideModal()">取消</button>';
        
        this.showModalRaw();
    }

    registerAsset() {
        this.pendingAssets.push(this.currentAsset);
        if (!this.selectedAssetIndices) {
            this.selectedAssetIndices = new Set();
        }
        this.selectedAssetIndices.add(this.currentAsset._index);
        this.renderDepartmentAssets();
        this.hideModal();
        this.showModal('登记成功', '资产已添加到待处理列表');
    }

    goToPending() {
        if (this.pendingAssets.length === 0) {
            this.showModal('提示', '请先登记至少一条遗留资产');
            return;
        }
        document.getElementById('pending-title').textContent = this.currentDepartment + ' - 遗留资产待处理';
        this.renderPendingAssets();
        this.showScreen('pending');
    }

    renderPendingAssets() {
        const pendingList = document.getElementById('pending-list');
        pendingList.innerHTML = '';
        
        this.pendingAssets.forEach((asset, index) => {
            const hasPhoto = asset.photos && asset.photos.length > 0;
            const div = document.createElement('div');
            div.className = 'pending-item';
            div.innerHTML = '<div class="asset-info"><div class="asset-name">' + (asset['资产名称'] || '未命名') + '</div><div class="asset-detail"><span>编号: ' + (asset['资产编号'] || '-') + '</span><span class="status-badge ' + (hasPhoto ? 'green' : 'red') + '">' + (hasPhoto ? '已留底' : '未留底') + '</span></div></div>';
            div.addEventListener('click', () => this.showPendingOptions(asset, index));
            pendingList.appendChild(div);
        });
    }

    showPendingOptions(asset, index) {
        this.currentAsset = { ...asset, _index: index };
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">' + asset['资产名称'] + '</h3><p><strong>编号:</strong> ' + (asset['资产编号'] || '-') + '</p>';
        
        if (asset.photos && asset.photos.length > 0) {
            modalBody.innerHTML += '<div class="photo-grid">';
            asset.photos.forEach((photo, idx) => {
                modalBody.innerHTML += '<img src="' + photo + '" class="photo-thumb" onclick="app.viewPhoto(' + idx + ')">';
            });
            modalBody.innerHTML += '</div>';
        }
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.takePhoto()">拍照记录</button><button class="modal-btn danger" onclick="app.removePending()">删除登记</button><button class="modal-btn secondary" onclick="app.hideModal()">取消</button>';
        
        this.showModalRaw();
    }

    takePhoto() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">拍照/上传照片</h3><input type="file" id="photo-upload" accept="image/*" capture="environment"><div id="photo-preview-container"></div>';
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.uploadPhoto()">上传</button><button class="modal-btn secondary" onclick="app.showPendingOptions(app.currentAsset, app.currentAsset._index)">返回</button>';
        
        setTimeout(() => {
            document.getElementById('photo-upload').addEventListener('change', (e) => this.previewPhoto(e));
        }, 100);
    }

    previewPhoto(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const container = document.getElementById('photo-preview-container');
            container.innerHTML = '<img src="' + e.target.result + '" class="photo-preview" id="current-photo">';
        };
        reader.readAsDataURL(file);
    }

    uploadPhoto() {
        const photoImg = document.getElementById('current-photo');
        if (!photoImg) {
            this.showModal('提示', '请先选择或拍摄照片');
            return;
        }
        
        if (!this.currentAsset.photos) {
            this.currentAsset.photos = [];
        }
        this.currentAsset.photos.push(photoImg.src);
        
        this.pendingAssets[this.currentAsset._index] = this.currentAsset;
        this.renderPendingAssets();
        this.showModal('成功', '照片已保存，数据已自动存储');
    }

    viewPhoto(idx) {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<img src="' + this.currentAsset.photos[idx] + '" class="photo-preview">';
        
        modalActions.innerHTML = '<button class="modal-btn secondary" onclick="app.showPendingOptions(app.currentAsset, app.currentAsset._index)">返回</button>';
    }

    removePending() {
        this.pendingAssets.splice(this.currentAsset._index, 1);
        this.renderPendingAssets();
        this.hideModal();
        
        if (this.pendingAssets.length === 0) {
            this.showScreen('department');
        }
    }

    completeRegistration() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">请上传科室对角照 (2张)</h3><p>照片1:</p><input type="file" id="corner1" accept="image/*" capture="environment"><div id="corner1-preview"></div><p style="margin-top: 15px;">照片2:</p><input type="file" id="corner2" accept="image/*" capture="environment"><div id="corner2-preview"></div>';
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.confirmComplete()">确认完成</button><button class="modal-btn secondary" onclick="app.hideModal()">取消</button>';
        
        setTimeout(() => {
            document.getElementById('corner1').addEventListener('change', (e) => this.previewCorner(e, 1));
            document.getElementById('corner2').addEventListener('change', (e) => this.previewCorner(e, 2));
        }, 100);
        
        this.cornerPhotos = {};
        this.showModalRaw();
    }

    previewCorner(event, num) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            this.cornerPhotos[num] = e.target.result;
            document.getElementById('corner' + num + '-preview').innerHTML = '<img src="' + e.target.result + '" class="photo-preview" style="max-height: 150px;">';
        };
        reader.readAsDataURL(file);
    }

    async confirmComplete() {
        if (!this.cornerPhotos[1] || !this.cornerPhotos[2]) {
            this.showModal('提示', '请上传两张对角照');
            return;
        }
        
        this.completedDepartments.set(this.currentDepartment, {
            assets: JSON.parse(JSON.stringify(this.pendingAssets)),
            cornerPhotos: [this.cornerPhotos[1], this.cornerPhotos[2]],
            timestamp: Date.now()
        });
        
        await this.saveData();
        this.hideModal();
        this.showModal('登记完成', '科室 ' + this.currentDepartment + ' 登记完成！\n\n数据已自动保存，建议您点击"备份数据"导出备份文件。');
        this.showScreen('main');
        this.renderMainScreen();
        
        setTimeout(() => {
            if (confirm('是否现在备份数据？')) {
                this.backupData();
            }
        }, 500);
    }

    showLegacyScreen() {
        this.renderLegacyScreen();
        this.showScreen('legacy');
    }

    renderLegacyScreen() {
        const legacyList = document.getElementById('legacy-list');
        legacyList.innerHTML = '';
        
        if (this.completedDepartments.size === 0) {
            legacyList.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无已完成登记的科室</p>';
            return;
        }
        
        this.completedDepartments.forEach((data, deptName) => {
            const div = document.createElement('div');
            div.className = 'legacy-item';
            div.innerHTML = '<div class="department-header"><span class="department-name">' + deptName + '</span><span class="status-badge green">已完成</span></div><p style="margin-top: 10px; color: #666; font-size: 13px;">遗留资产数量: ' + data.assets.length + '</p>';
            div.addEventListener('click', () => this.viewLegacyDepartment(deptName, data));
            legacyList.appendChild(div);
        });
    }

    viewLegacyDepartment(deptName, data) {
        this.currentDepartment = deptName;
        this.pendingAssets = [...data.assets];
        
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">' + deptName + ' - 遗留资产</h3><div id="legacy-assets-list"></div><h4 style="margin-top: 20px;">科室对角照:</h4><div class="photo-grid"><img src="' + data.cornerPhotos[0] + '" class="photo-thumb" onclick="event.stopPropagation(); app.viewFullPhoto(\'' + data.cornerPhotos[0] + '\')"><img src="' + data.cornerPhotos[1] + '" class="photo-thumb" onclick="event.stopPropagation(); app.viewFullPhoto(\'' + data.cornerPhotos[1] + '\')"></div>';
        
        modalActions.innerHTML = '<button class="modal-btn secondary" onclick="app.hideModal()">关闭</button>';
        
        this.showModalRaw();
        
        setTimeout(() => {
            const list = document.getElementById('legacy-assets-list');
            this.pendingAssets.forEach((asset, idx) => {
                const div = document.createElement('div');
                div.className = 'asset-item';
                div.style.margin = '10px 0';
                const hasPhoto = asset.photos && asset.photos.length > 0;
                let html = '<div class="asset-info"><div class="asset-name">' + (asset['资产名称'] || '未命名') + '</div><div class="asset-detail"><span>编号: ' + (asset['资产编号'] || '-') + '</span><span class="status-badge ' + (hasPhoto ? 'green' : 'red') + '">' + (hasPhoto ? '已留底' : '未留底') + '</span></div>';
                if (hasPhoto) {
                    html += '<div class="photo-grid">';
                    asset.photos.forEach(p => {
                        html += '<img src="' + p + '" class="photo-thumb" onclick="event.stopPropagation(); app.viewFullPhoto(\'' + p + '\')">';
                    });
                    html += '</div>';
                }
                html += '</div>';
                div.innerHTML = html;
                div.addEventListener('click', () => this.editLegacyAsset(asset, idx));
                list.appendChild(div);
            });
        }, 100);
    }

    viewFullPhoto(src) {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<img src="' + src + '" class="photo-preview">';
        modalActions.innerHTML = '<button class="modal-btn secondary" onclick="app.viewLegacyDepartment(app.currentDepartment, app.completedDepartments.get(app.currentDepartment))">返回</button>';
        this.showModalRaw();
    }

    editLegacyAsset(asset, index) {
        this.currentAsset = { ...asset, _index: index };
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        let html = '<h3 style="margin-bottom: 15px;">' + asset['资产名称'] + '</h3><p><strong>编号:</strong> ' + (asset['资产编号'] || '-') + '</p>';
        if (asset.photos) {
            html += '<div class="photo-grid">';
            asset.photos.forEach(p => {
                html += '<img src="' + p + '" class="photo-thumb" onclick="event.stopPropagation(); app.viewFullPhoto(\'' + p + '\')">';
            });
            html += '</div>';
        }
        modalBody.innerHTML = html;
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.addPhotoToLegacy()">添加照片</button><button class="modal-btn" onclick="app.savePhotosToLocal()">保存到本地</button><button class="modal-btn danger" onclick="app.deleteLegacyAsset()">删除</button><button class="modal-btn secondary" onclick="app.viewLegacyDepartment(app.currentDepartment, app.completedDepartments.get(app.currentDepartment))">返回</button>';
        
        this.showModalRaw();
    }

    savePhotosToLocal() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">保存照片到本地</h3><p>照片将保存到 <strong>下载文件夹</strong></p><p style="color: #666; font-size: 13px; margin-top: 10px;">系统会生成下载链接，点击即可保存照片。</p>';
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.generateLocalDownloads()">生成下载链接</button><button class="modal-btn secondary" onclick="app.editLegacyAsset(app.currentAsset, app.currentAsset._index)">返回</button>';
        
        this.showModalRaw();
    }

    generateLocalDownloads() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        let html = '<h3 style="margin-bottom: 15px;">下载照片</h3><p>请点击以下链接下载照片：</p><div style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">';
        
        if (this.currentAsset.photos) {
            this.currentAsset.photos.forEach((photo, idx) => {
                const fileName = this.currentDepartment + '_' + (this.currentAsset['资产名称'] || 'asset') + '_' + String(idx + 1).padStart(2, '0') + '.jpg';
                html += '<a href="' + photo + '" download="' + fileName + '" style="padding: 10px; background: #f0f0f0; border-radius: 5px; text-decoration: none; color: #333;">下载照片 ' + (idx + 1) + '</a>';
            });
        }
        
        html += '</div>';
        modalBody.innerHTML = html;
        modalActions.innerHTML = '<button class="modal-btn secondary" onclick="app.editLegacyAsset(app.currentAsset, app.currentAsset._index)">返回</button>';
        this.showModalRaw();
    }

    addPhotoToLegacy() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">添加照片</h3><input type="file" id="legacy-photo" accept="image/*" capture="environment"><div id="legacy-preview"></div>';
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.saveLegacyPhoto()">保存</button><button class="modal-btn secondary" onclick="app.editLegacyAsset(app.currentAsset, app.currentAsset._index)">返回</button>';
        
        setTimeout(() => {
            document.getElementById('legacy-photo').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('legacy-preview').innerHTML = '<img src="' + e.target.result + '" class="photo-preview" id="new-legacy-photo">';
                };
                reader.readAsDataURL(file);
            });
        }, 100);
        
        this.showModalRaw();
    }

    async saveLegacyPhoto() {
        const photo = document.getElementById('new-legacy-photo');
        if (!photo) {
            this.showModal('提示', '请先选择照片');
            return;
        }
        
        if (!this.currentAsset.photos) {
            this.currentAsset.photos = [];
        }
        this.currentAsset.photos.push(photo.src);
        
        const deptData = this.completedDepartments.get(this.currentDepartment);
        deptData.assets[this.currentAsset._index] = this.currentAsset;
        this.completedDepartments.set(this.currentDepartment, deptData);
        await this.saveData();
        
        this.showModal('成功', '照片已添加，数据已自动保存');
        this.viewLegacyDepartment(this.currentDepartment, deptData);
    }

    async deleteLegacyAsset() {
        const deptData = this.completedDepartments.get(this.currentDepartment);
        deptData.assets.splice(this.currentAsset._index, 1);
        this.completedDepartments.set(this.currentDepartment, deptData);
        await this.saveData();
        this.showModal('成功', '资产已删除，数据已自动保存');
        this.viewLegacyDepartment(this.currentDepartment, deptData);
    }

    async exportAll() {
        if (this.completedDepartments.size === 0) {
            this.showModal('提示', '暂无已完成登记的科室');
            return;
        }
        
        try {
            this.showModal('处理中', '正在打包文件，请稍候...');
            
            const zip = new JSZip();
            const allData = [];
            
            for (const [deptName, data] of this.completedDepartments) {
                const folder = zip.folder(deptName);
                
                data.assets.forEach((asset, idx) => {
                    allData.push({
                        '科室': deptName,
                        '资产编号': asset['资产编号'] || '',
                        '资产名称': asset['资产名称'] || '',
                        '规格型号': asset['规格型号'] || '',
                        '资产原值': asset['资产原值'] || '',
                        '使用人': asset['使用人'] || '',
                        '购置日期': asset['购置日期'] || '',
                        '备注': asset['备注'] || ''
                    });
                    
                    if (asset.photos) {
                        asset.photos.forEach((photo, photoIdx) => {
                            const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
                            const ext = photo.split(';')[0].split('/')[1];
                            let fileName = deptName + '_' + (asset['资产名称'] || 'asset');
                            if (photoIdx > 0) fileName += '_' + String(photoIdx + 1).padStart(2, '0');
                            fileName += '.' + ext;
                            folder.file(fileName, base64Data, { base64: true });
                        });
                    }
                });
                
                if (data.cornerPhotos) {
                    data.cornerPhotos.forEach((photo, idx) => {
                        const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
                        const ext = photo.split(';')[0].split('/')[1];
                        folder.file(deptName + '_corner_' + (idx + 1) + '.' + ext, base64Data, { base64: true });
                    });
                }
            }
            
            const ws = XLSX.utils.json_to_sheet(allData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Legacy_Assets');
            const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            zip.file('legacy_assets_statistics.xlsx', excelBuffer);
            
            const content = await zip.generateAsync({ type: 'blob' });
            const fileName = 'zichen_asset_system_export_' + new Date().toISOString().slice(0, 10) + '.zip';
            
            this.hideModal();
            
            try {
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
                
                this.showExportSuccessModal();
            } catch (downloadError) {
                console.error('ZIP下载失败:', downloadError);
                this.showExportAlternativeModal();
            }
        } catch (error) {
            console.error(error);
            this.hideModal();
            this.showModal('导出失败', '导出过程中发生错误，请重试');
        }
    }
    
    showExportAlternativeModal() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 60px; margin-bottom: 15px;">⚠️</div>
                <h3 style="color: #ff9800; margin-bottom: 20px;">导出遇到问题</h3>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 10px;">
                <p style="margin: 0; font-weight: bold; color: #856404;">💡 建议方案：</p>
                <ul style="margin: 10px 0 0 20px; color: #856404; font-size: 14px;">
                    <li>先点击"备份数据"保存JSON文件</li>
                    <li>在电脑浏览器中恢复备份后再导出</li>
                </ul>
            </div>
        `;
        
        modalActions.innerHTML = '<button class="modal-btn secondary" onclick="app.hideModal()">关闭</button>';
        this.showModalRaw();
    }

    showExportSuccessModal() {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 60px; margin-bottom: 15px;">🎉</div>
                <h3 style="color: #667eea; margin-bottom: 20px;">导出成功！</h3>
            </div>
            <div style="background: #e8f4fd; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
                <p style="margin: 0; font-weight: bold; color: #0c5460;">📦 导出文件包含：</p>
                <ul style="margin: 10px 0 0 20px; color: #0c5460; font-size: 14px;">
                    <li>legacy_assets_statistics.xlsx</li>
                    <li>各科室照片文件夹</li>
                    <li>科室对角照</li>
                </ul>
            </div>
            <div style="background: #d4edda; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
                <p style="margin: 0; font-weight: bold; color: #155724;">📁 文件保存位置：</p>
                <p style="margin: 5px 0 0 0; color: #155724;">浏览器下载文件夹</p>
            </div>
        `;
        
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.hideModal()">知道了</button>';
        this.showModalRaw();
    }

    showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screen + '-screen').classList.add('active');
    }

    showModal(title, message) {
        const modalBody = document.getElementById('modal-body');
        const modalActions = document.getElementById('modal-actions');
        
        modalBody.innerHTML = '<h3 style="margin-bottom: 15px;">' + title + '</h3><p style="white-space: pre-line;">' + message + '</p>';
        modalActions.innerHTML = '<button class="modal-btn primary" onclick="app.hideModal()">确定</button>';
        
        this.showModalRaw();
    }

    showModalRaw() {
        document.getElementById('modal').classList.add('active');
    }

    hideModal() {
        document.getElementById('modal').classList.remove('active');
    }
}

let app;
window.addEventListener('DOMContentLoaded', function() {
    console.log('=== 页面DOM加载完成 ===');
    app = new AssetManagementSystem();
});
