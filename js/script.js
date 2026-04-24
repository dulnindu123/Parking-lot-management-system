import { db } from "./firebase-config.js";
import { collection, doc, setDoc, deleteDoc, getDoc, updateDoc, onSnapshot, addDoc, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

class ParkingLotManager {
    constructor() {
        this.totalSpots = 100;
        this.spotsPerFloor = 50;
        this.currentFloor = 1;
        
        // Rates per hour
        this.rates = {
            car: 5,
            motorcycle: 3,
            truck: 8,
            vip: 15
        };

        this.vehicles = new Map();
        this.history = [];
        this.revenue = 0;
        this.parkingSpots = new Array(this.totalSpots).fill(null);

        this.initUI();
        this.initTheme();
        this.initFirestoreListeners();
        this.startLiveTimer();
    }

    initFirestoreListeners() {
        // 1. Listen to System Data (Revenue)
        const systemRef = doc(db, "system", "stats");
        onSnapshot(systemRef, (docSnap) => {
            if (docSnap.exists()) {
                this.revenue = docSnap.data().totalRevenue || 0;
            } else {
                setDoc(systemRef, { totalRevenue: 0 }); // Initialize if missing
            }
            this.updateStats();
        });

        // 2. Listen to Vehicles
        const vehiclesRef = collection(db, "vehicles");
        onSnapshot(vehiclesRef, (snapshot) => {
            this.vehicles.clear();
            this.parkingSpots.fill(null);
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const vehicle = {
                    licensePlate: docSnap.id,
                    type: data.type,
                    spotNumber: data.spotNumber,
                    // Handle Firestore Timestamps
                    checkInTime: data.checkInTime?.toDate ? data.checkInTime.toDate() : new Date(data.checkInTime)
                };
                this.vehicles.set(vehicle.licensePlate, vehicle);
                this.parkingSpots[vehicle.spotNumber - 1] = vehicle;
            });
            
            this.updateStats();
            this.renderGrid();
            this.updateVehicleList();
        });

        // 3. Listen to Transactions History (Last 50)
        const q = query(collection(db, "transactions"), orderBy("timestamp", "desc"), limit(50));
        onSnapshot(q, (snapshot) => {
            this.history = [];
            snapshot.forEach((docSnap) => {
                this.history.push({ id: docSnap.id, ...docSnap.data() });
            });
            this.renderHistory();
        });
    }

    initUI() {
        // Bind Action Tabs
        document.getElementById('tab-in').addEventListener('click', () => this.switchTab('in'));
        document.getElementById('tab-out').addEventListener('click', () => this.switchTab('out'));
        document.getElementById('tab-search').addEventListener('click', () => this.switchTab('search'));

        // Bind Floor Tabs
        document.querySelectorAll('.floor-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.floor-tab').forEach(b => {
                    b.classList.remove('active', 'text-primary');
                    b.classList.add('text-muted');
                });
                e.target.classList.add('active', 'text-primary');
                e.target.classList.remove('text-muted');
                this.currentFloor = parseInt(e.target.dataset.floor);
                this.renderGrid();
            });
        });

        // Bind Forms
        document.getElementById('form-in').addEventListener('submit', (e) => {
            e.preventDefault();
            this.checkInVehicle();
        });
        document.getElementById('form-out').addEventListener('submit', (e) => {
            e.preventDefault();
            this.checkOutVehicle();
        });
        document.getElementById('form-search').addEventListener('submit', (e) => {
            e.preventDefault();
            this.searchVehicle();
        });

        // Auto-uppercase
        ['in-plate', 'out-plate', 'search-plate'].forEach(id => {
            document.getElementById(id).addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase();
            });
        });

        // History Modal
        document.getElementById('view-history-btn').addEventListener('click', () => {
            document.getElementById('history-modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('history-modal').classList.add('modal-show'), 10);
        });
        document.getElementById('close-history').addEventListener('click', () => {
            document.getElementById('history-modal').classList.remove('modal-show');
            setTimeout(() => document.getElementById('history-modal').classList.add('hidden'), 300);
        });
        document.getElementById('clear-history').addEventListener('click', async () => {
            if(confirm('Are you sure you want to clear history? (Note: For safety, this just clears the view locally in this prototype)')) {
                this.showToast('History hidden locally', 'info');
            }
        });

        // Receipt Modal
        document.getElementById('close-receipt').addEventListener('click', () => {
            document.getElementById('receipt-modal').classList.remove('modal-show');
            setTimeout(() => document.getElementById('receipt-modal').classList.add('hidden'), 300);
        });
    }

    initTheme() {
        const toggleBtn = document.getElementById('theme-toggle');
        const icon = document.getElementById('theme-icon');
        
        const currentTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
        this.updateThemeIcon(currentTheme, icon);

        toggleBtn.addEventListener('click', () => {
            let theme = document.documentElement.getAttribute('data-theme');
            let newTheme = theme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            this.updateThemeIcon(newTheme, icon);
        });
    }

    updateThemeIcon(theme, icon) {
        if(theme === 'dark') {
            icon.className = 'fa-solid fa-sun text-yellow-500';
        } else {
            icon.className = 'fa-solid fa-moon';
        }
    }

    switchTab(tab) {
        document.querySelectorAll('.action-tab').forEach(t => {
            t.classList.remove('border-accent', 'text-accent', 'active');
            t.classList.add('border-transparent', 'text-muted');
        });
        document.querySelectorAll('.action-form').forEach(f => f.classList.add('hidden'));

        document.getElementById(`tab-${tab}`).classList.add('border-accent', 'text-accent', 'active');
        document.getElementById(`tab-${tab}`).classList.remove('border-transparent', 'text-muted');
        document.getElementById(`form-${tab}`).classList.remove('hidden');
    }

    getVehicleIcon(type) {
        switch(type) {
            case 'car': return '<i class="fa-solid fa-car"></i>';
            case 'motorcycle': return '<i class="fa-solid fa-motorcycle"></i>';
            case 'truck': return '<i class="fa-solid fa-truck"></i>';
            case 'vip': return '<i class="fa-solid fa-crown"></i>';
            default: return '<i class="fa-solid fa-car"></i>';
        }
    }

    renderGrid() {
        const grid = document.getElementById('parking-grid');
        grid.innerHTML = '';
        
        const startSpot = (this.currentFloor - 1) * this.spotsPerFloor;
        const endSpot = startSpot + this.spotsPerFloor;

        for (let i = startSpot; i < endSpot; i++) {
            const spotNum = i + 1;
            const isVip = spotNum <= 10;
            const vehicle = this.parkingSpots[i];
            
            const spotEl = document.createElement('div');
            
            if (vehicle) {
                spotEl.className = 'parking-spot occupied';
                spotEl.innerHTML = `${this.getVehicleIcon(vehicle.type)}<span>${spotNum}</span><span class="text-[0.6rem] opacity-75 mt-1">${vehicle.licensePlate}</span>`;
            } else {
                spotEl.className = `parking-spot ${isVip ? 'vip-spot available' : ''}`;
                spotEl.innerHTML = `${isVip ? '<i class="fa-solid fa-crown text-vip-text opacity-50"></i>' : ''}<span>${spotNum}</span>`;
            }
            
            spotEl.onclick = () => this.handleSpotClick(spotNum);
            grid.appendChild(spotEl);
        }
    }

    handleSpotClick(spotNum) {
        const vehicle = this.parkingSpots[spotNum - 1];
        if (vehicle) {
            this.showToast(`Spot ${spotNum}: ${vehicle.licensePlate} (${vehicle.type})`, 'info');
        } else {
            const isVip = spotNum <= 10;
            this.showToast(`Spot ${spotNum} is available ${isVip ? '(VIP)' : ''}`, 'info');
            document.getElementById('in-spot').value = spotNum;
            this.switchTab('in');
        }
    }

    findAvailableSpot(isVipRequest) {
        if (isVipRequest) {
            for (let i = 0; i < 10; i++) {
                if (this.parkingSpots[i] === null) return i + 1;
            }
            return null;
        }
        for (let i = 10; i < this.totalSpots; i++) {
            if (this.parkingSpots[i] === null) return i + 1;
        }
        return null;
    }

    async checkInVehicle() {
        const submitBtn = document.querySelector('#form-in button');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Checking In...';

        try {
            const licensePlate = document.getElementById('in-plate').value.trim();
            const vehicleType = document.getElementById('in-type').value;
            const spotInput = document.getElementById('in-spot').value;

            if (this.vehicles.has(licensePlate)) {
                this.showToast('Vehicle is already parked!', 'error');
                return;
            }

            let spotNumber;
            const isVipRequest = vehicleType === 'vip';

            if (spotInput) {
                spotNumber = parseInt(spotInput);
                if (spotNumber < 1 || spotNumber > this.totalSpots) {
                    this.showToast('Invalid spot number', 'error');
                    return;
                }
                if (this.parkingSpots[spotNumber - 1] !== null) {
                    this.showToast(`Spot ${spotNumber} is occupied`, 'error');
                    return;
                }
                if (!isVipRequest && spotNumber <= 10) {
                    this.showToast(`Spot ${spotNumber} is reserved for VIPs`, 'error');
                    return;
                }
            } else {
                spotNumber = this.findAvailableSpot(isVipRequest);
                if (!spotNumber) {
                    this.showToast(`No available ${isVipRequest ? 'VIP ' : ''}spots`, 'error');
                    return;
                }
            }

            // Write to Firestore
            await setDoc(doc(db, "vehicles", licensePlate), {
                type: vehicleType,
                spotNumber: spotNumber,
                checkInTime: new Date() // Firestore automatically handles JS Dates
            });
            
            document.getElementById('form-in').reset();
            this.showToast(`${licensePlate} checked into Spot ${spotNumber}`, 'success');
        } catch (error) {
            console.error("Error checking in: ", error);
            this.showToast('Database Error', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket mr-2"></i> Check In Vehicle';
        }
    }

    calculateDurationAndFee(checkInTime, type) {
        const now = new Date();
        const diffMs = now - checkInTime;
        const hours = Math.ceil(diffMs / (1000 * 60 * 60));
        const exactMinutes = Math.floor(diffMs / (1000 * 60));
        
        const displayHours = Math.floor(exactMinutes / 60);
        const displayMins = exactMinutes % 60;
        const durationText = displayHours > 0 ? `${displayHours}h ${displayMins}m` : `${displayMins}m`;
        
        const fee = Math.max(1, hours) * this.rates[type]; 
        
        return { fee, durationText };
    }

    async checkOutVehicle() {
        const submitBtn = document.querySelector('#form-out button');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Processing...';

        try {
            const licensePlate = document.getElementById('out-plate').value.trim();
            const vehicle = this.vehicles.get(licensePlate);

            if (!vehicle) {
                this.showToast('Vehicle not found', 'error');
                return;
            }

            const checkOutTime = new Date();
            const { fee, durationText } = this.calculateDurationAndFee(vehicle.checkInTime, vehicle.type);
            
            // 1. Delete from vehicles collection
            await deleteDoc(doc(db, "vehicles", licensePlate));

            // 2. Add to history collection
            await addDoc(collection(db, "transactions"), {
                plate: licensePlate,
                spot: vehicle.spotNumber,
                type: vehicle.type,
                duration: durationText,
                fee: fee,
                date: checkOutTime.toLocaleString(),
                timestamp: checkOutTime
            });

            // 3. Update total revenue in system
            const newRevenue = this.revenue + fee;
            await updateDoc(doc(db, "system", "stats"), {
                totalRevenue: newRevenue
            });

            document.getElementById('form-out').reset();
            this.showReceipt(vehicle, checkOutTime, durationText, fee);
        } catch (error) {
            console.error("Error checking out: ", error);
            this.showToast('Database Error', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket mr-2"></i> Check Out & Pay';
        }
    }

    showReceipt(vehicle, outTime, duration, fee) {
        document.getElementById('rec-plate').textContent = vehicle.licensePlate;
        document.getElementById('rec-type').textContent = vehicle.type;
        document.getElementById('rec-spot').textContent = `${vehicle.spotNumber} (Floor ${Math.ceil(vehicle.spotNumber/this.spotsPerFloor)})`;
        document.getElementById('rec-in').textContent = vehicle.checkInTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        document.getElementById('rec-out').textContent = outTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        document.getElementById('rec-duration').textContent = duration;
        document.getElementById('rec-fee').textContent = `$${fee.toFixed(2)}`;

        const modal = document.getElementById('receipt-modal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('modal-show'), 10);
    }

    searchVehicle() {
        const licensePlate = document.getElementById('search-plate').value.trim();
        const vehicle = this.vehicles.get(licensePlate);

        if (vehicle) {
            const { fee, durationText } = this.calculateDurationAndFee(vehicle.checkInTime, vehicle.type);
            this.showToast(`Found ${licensePlate} in Spot ${vehicle.spotNumber}. Fee: $${fee.toFixed(2)}`, 'info');
            
            const vehicleFloor = Math.ceil(vehicle.spotNumber / this.spotsPerFloor);
            if (this.currentFloor !== vehicleFloor) {
                document.querySelector(`.floor-tab[data-floor="${vehicleFloor}"]`).click();
            }

            setTimeout(() => {
                const spots = document.querySelectorAll('.parking-spot');
                const indexOnFloor = (vehicle.spotNumber - 1) % this.spotsPerFloor;
                const spotEl = spots[indexOnFloor];
                if(spotEl) {
                    spotEl.classList.add('ring-4', 'ring-accent', 'ring-offset-2', 'ring-offset-bg-primary');
                    setTimeout(() => {
                        spotEl.classList.remove('ring-4', 'ring-accent', 'ring-offset-2', 'ring-offset-bg-primary');
                    }, 3000);
                }
            }, 100);

        } else {
            this.showToast('Vehicle not found', 'error');
        }
        document.getElementById('form-search').reset();
    }

    updateStats() {
        const occupied = this.vehicles.size;
        const available = this.totalSpots - occupied;
        
        document.getElementById('stat-total').textContent = this.totalSpots;
        document.getElementById('stat-available').textContent = available;
        document.getElementById('stat-occupied').textContent = occupied;
        document.getElementById('stat-revenue').textContent = `$${this.revenue.toFixed(2)}`;
        document.getElementById('active-count').textContent = occupied;
    }

    updateVehicleList() {
        const list = document.getElementById('vehicle-list');
        
        if (this.vehicles.size === 0) {
            list.innerHTML = '<div class="text-center text-muted mt-10 text-sm">No vehicles parked right now.</div>';
            return;
        }

        let html = '';
        this.vehicles.forEach(vehicle => {
            const { fee, durationText } = this.calculateDurationAndFee(vehicle.checkInTime, vehicle.type);
            
            html += `
                <div class="bg-primary border border-custom p-3 rounded-lg flex justify-between items-center group hover:border-accent transition-colors">
                    <div class="flex items-center space-x-3">
                        <div class="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-accent">
                            ${this.getVehicleIcon(vehicle.type)}
                        </div>
                        <div>
                            <p class="font-bold text-sm tracking-wide">${vehicle.licensePlate}</p>
                            <p class="text-xs text-muted">Spot ${vehicle.spotNumber} • <span class="live-duration" data-time="${vehicle.checkInTime.getTime()}">${durationText}</span></p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-sm text-green-500 live-fee" data-type="${vehicle.type}" data-time="${vehicle.checkInTime.getTime()}">$${fee.toFixed(2)}</p>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;
    }

    renderHistory() {
        const tbody = document.getElementById('history-table-body');
        const emptyMsg = document.getElementById('history-empty');
        
        if (this.history.length === 0) {
            tbody.innerHTML = '';
            emptyMsg.classList.remove('hidden');
            return;
        }

        emptyMsg.classList.add('hidden');
        let html = '';
        this.history.forEach(t => {
            html += `
                <tr class="border-b border-custom hover:bg-secondary transition-colors">
                    <td class="py-3 font-semibold">${t.plate}</td>
                    <td class="py-3">Spot ${t.spot}</td>
                    <td class="py-3 text-muted">${t.duration}</td>
                    <td class="py-3 text-green-500 font-medium">$${t.fee.toFixed(2)}</td>
                    <td class="py-3 text-muted">${t.date}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    startLiveTimer() {
        setInterval(() => {
            document.querySelectorAll('.live-duration').forEach(el => {
                const time = parseInt(el.dataset.time);
                const now = new Date();
                const diffMs = now - time;
                const exactMinutes = Math.floor(diffMs / (1000 * 60));
                const displayHours = Math.floor(exactMinutes / 60);
                const displayMins = exactMinutes % 60;
                el.textContent = displayHours > 0 ? `${displayHours}h ${displayMins}m` : `${displayMins}m`;
            });

            document.querySelectorAll('.live-fee').forEach(el => {
                const time = parseInt(el.dataset.time);
                const type = el.dataset.type;
                const now = new Date();
                const diffMs = now - time;
                const hours = Math.ceil(diffMs / (1000 * 60 * 60));
                const fee = Math.max(1, hours) * this.rates[type];
                el.textContent = `$${fee.toFixed(2)}`;
            });
        }, 60000);
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        
        let icon, bgClass, textClass;
        if (type === 'success') {
            icon = '<i class="fa-solid fa-circle-check"></i>';
            bgClass = 'bg-green-100 dark:bg-green-900/30';
            textClass = 'text-green-600 dark:text-green-400';
        } else if (type === 'error') {
            icon = '<i class="fa-solid fa-circle-xmark"></i>';
            bgClass = 'bg-red-100 dark:bg-red-900/30';
            textClass = 'text-red-600 dark:text-red-400';
        } else {
            icon = '<i class="fa-solid fa-circle-info"></i>';
            bgClass = 'bg-blue-100 dark:bg-blue-900/30';
            textClass = 'text-blue-600 dark:text-blue-400';
        }

        toast.className = `toast flex items-center p-4 rounded-lg shadow-lg border border-custom bg-card max-w-sm w-full`;
        toast.innerHTML = `
            <div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-lg ${bgClass} ${textClass}">
                ${icon}
            </div>
            <div class="ml-3 text-sm font-medium text-primary">${message}</div>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
}

// Ensure modules execute after DOM loads
document.addEventListener('DOMContentLoaded', () => {
    window.parkingApp = new ParkingLotManager();
});
