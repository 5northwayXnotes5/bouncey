import * as THREE from 'three';

// --- AUDIO SYSTEM ---
const Audio = {
    ctx: null,
    init: () => {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        Audio.ctx = new AudioContext();
    },
    playBounce: (velocity) => {
        if (!Audio.ctx) return;
        if (Audio.ctx.state === 'suspended') Audio.ctx.resume();

        const osc = Audio.ctx.createOscillator();
        const gain = Audio.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(Audio.ctx.destination);

        // Map velocity to pitch (higher velocity = higher pitch)
        const baseFreq = 200;
        const pitchMod = Math.min(Math.abs(velocity) * 20, 600);
        osc.frequency.setValueAtTime(baseFreq + pitchMod, Audio.ctx.currentTime);
        osc.type = 'sine';

        // Percussive envelope
        gain.gain.setValueAtTime(0.3, Audio.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, Audio.ctx.currentTime + 0.15);

        osc.start();
        osc.stop(Audio.ctx.currentTime + 0.15);
    }
};

// --- PRNG ---
class PRNG {
    constructor(seed) {
        this.seed = this.hash(seed);
    }
    hash(str) {
        let h = 0xdeadbeef;
        str = str.toString();
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
            h = ((h ^ h >>> 16) * 2246822507) >>> 0;
        }
        return h;
    }
    next() {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }
    range(min, max) {
        return min + this.next() * (max - min);
    }
}

const CONSTANTS = {
    gravity: -35,
    bounce: 0.75,
    friction: 0.99,
    ballRadius: 0.5,
    chunkHeight: 12
};

let scene, camera, renderer;
let ball;
let obstacles = [];
let particles = [];
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let lastTime = 0;
const timeStep = 1 / 60;
let accumulator = 0;

let state = {
    velocity: new THREE.Vector3(0, 0, 0),
    position: new THREE.Vector3(0, 10, 0),
    active: false,
    seed: 12345,
    theme: 'neon',
    difficulty: 5
};

const UI = {
    layer: document.getElementById('ui-layer'),
    seed: document.getElementById('seed-input'),
    diff: document.getElementById('diff-slider'),
    theme: document.getElementById('theme-select'),
    btnRandom: document.getElementById('btn-randomize'),
    btnReset: document.getElementById('btn-reset'),
    btnRecord: document.getElementById('btn-record')
};

function init() {
    scene = new THREE.Scene();
    
    // Orthographic camera for that clean "2.5D" look
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 24; 
    camera = new THREE.OrthographicCamera(
        frustumSize * aspect / -2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        frustumSize / -2,
        1,
        1000
    );
    
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    setupEvents();
    generateLevel(); 
    
    // Start loop
    requestAnimationFrame(animate);
}

function setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(15, 30, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    // Ensure shadow box covers the falling area
    const d = 20;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);
}

function getThemeColors(theme) {
    switch(theme) {
        case 'pastel':
            return { bg: 0xffeebb, ball: 0xff6b6b, obs: 0x4ecdc4 };
        case 'monochrome':
            return { bg: 0x111111, ball: 0xffffff, obs: 0x333333 };
        case 'neon':
        default:
            return { bg: 0x050505, ball: 0xff00ff, obs: 0x00ffff };
    }
}

function generateLevel() {
    state.active = false;
    
    // Clear scene properly
    while(scene.children.length > 0){ 
        scene.remove(scene.children[0]); 
    }
    obstacles = [];
    particles = [];

    setupLights();

    const colors = getThemeColors(state.theme);
    scene.background = new THREE.Color(colors.bg);

    // Ball
    const ballGeo = new THREE.SphereGeometry(CONSTANTS.ballRadius, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({ 
        color: colors.ball,
        roughness: 0.1,
        metalness: 0.3,
        emissive: colors.ball,
        emissiveIntensity: 0.4
    });
    ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    scene.add(ball);

    // Reset Physics State
    state.position.set(0, 10, 0);
    state.velocity.set(0, 0, 0);
    ball.position.copy(state.position);

    const rng = new PRNG(state.seed);
    let yPos = 5;

    // Generate Chunks
    for (let i = 0; i < 60; i++) {
        const type = Math.floor(rng.next() * 3);
        const gap = rng.range(-2, 2);
        
        const mat = new THREE.MeshStandardMaterial({ 
            color: colors.obs,
            roughness: 0.2,
            metalness: 0.6
        });

        if (type === 0) {
            // Split Platform
            const w1 = 4 + gap;
            const w2 = 4 - gap;
            createBox(new THREE.Vector3(-3 - (4-w1)/2, yPos, 0), new THREE.Vector3(w1, 1, 4), mat);
            createBox(new THREE.Vector3(3 + (4-w2)/2, yPos, 0), new THREE.Vector3(w2, 1, 4), mat);
        } else if (type === 1) {
            // Rotated Ramp
            const rot = rng.range(-0.4, 0.4);
            const box = createBox(new THREE.Vector3(0, yPos, 0), new THREE.Vector3(7, 0.5, 4), mat);
            box.rotation.z = rot;
        } else {
            // Bumper Block
            const xOff = rng.range(-3, 3);
            createBox(new THREE.Vector3(xOff, yPos, 0), new THREE.Vector3(2, 2, 2), mat, true);
        }

        yPos -= (CONSTANTS.chunkHeight - (state.difficulty * 0.5));
    }

    // Floor
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({ color: colors.bg });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = yPos - 20;
    floor.receiveShadow = true;
    scene.add(floor);

    // CRITICAL: Update matrices so physics knows where things are before first frame
    scene.updateMatrixWorld(true);

    state.active = true;
}

function createBox(pos, size, mat, isBumper = false) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.userData = { size: size, isBumper: isBumper };
    scene.add(mesh);
    obstacles.push(mesh);
    return mesh;
}

function createParticle(pos, color) {
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData = {
        vel: new THREE.Vector3((Math.random()-0.5)*10, Math.random()*10, (Math.random()-0.5)*10)
    };
    scene.add(mesh);
    particles.push(mesh);
}

function physicsStep() {
    if (!state.active) return;

    // Apply gravity
    state.velocity.y += CONSTANTS.gravity * timeStep;
    
    // Predict next position
    let nextPos = state.position.clone().add(state.velocity.clone().multiplyScalar(timeStep));
    
    let collided = false;
    const sphere = new THREE.Sphere(nextPos, CONSTANTS.ballRadius);

    for (const obs of obstacles) {
        // Optimisation: Simple distance check before expensive box check
        if (obs.position.distanceToSquared(nextPos) > 100) continue;

        const box = new THREE.Box3().setFromObject(obs);

        if (box.intersectsSphere(sphere)) {
            // Find collision point
            const closest = new THREE.Vector3();
            box.clampPoint(sphere.center, closest);
            
            const normal = sphere.center.clone().sub(closest).normalize();
            
            // Audio Trigger
            const impactVel = state.velocity.length();
            if (impactVel > 2) Audio.playBounce(impactVel);

            // Bumper logic
            if (obs.userData.isBumper) {
                state.velocity.reflect(normal).multiplyScalar(1.2);
                createParticle(closest, 0xffffff);
            } else {
                state.velocity.reflect(normal).multiplyScalar(CONSTANTS.bounce);
                // Apply friction on floor/flat surfaces
                if (normal.y > 0.5) {
                    const friction = new THREE.Vector3(-state.velocity.x * 0.1, 0, -state.velocity.z * 0.1);
                    state.velocity.add(friction);
                }
            }
            
            // Penetration Resolution (Fix sticky ball)
            const penetration = CONSTANTS.ballRadius - sphere.center.distanceTo(closest);
            // Push ball out along normal + small epsilon
            nextPos.copy(closest).add(normal.multiplyScalar(CONSTANTS.ballRadius + 0.001));
            
            collided = true;
            // Break after one collision to prevent jitter in corners (simple solver)
            break; 
        }
    }

    state.position.copy(nextPos);
    
    // Sync visual mesh
    ball.position.copy(state.position);
    ball.rotation.x += state.velocity.z * timeStep * 0.5;
    ball.rotation.z -= state.velocity.x * timeStep * 0.5;
}

function updateCamera() {
    if (!ball) return;
    const targetY = state.position.y;
    // Smooth follow logic
    const currentY = camera.position.y;
    // Offset camera so ball is slightly above center (better for vertical video)
    const smoothY = THREE.MathUtils.lerp(currentY, targetY - 2, 0.1);
    
    camera.position.set(20, smoothY + 20, 20);
    camera.lookAt(0, smoothY, 0);
}

function animate(time) {
    requestAnimationFrame(animate);

    const delta = (time - lastTime) / 1000;
    lastTime = time;
    
    // Cap delta to prevent spiral of death on lag spikes
    accumulator += Math.min(delta, 0.1);

    while (accumulator > timeStep) {
        physicsStep();
        accumulator -= timeStep;
    }

    updateCamera();
    
    // Animate Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.position.add(p.userData.vel.clone().multiplyScalar(0.02));
        p.userData.vel.y -= 0.5; // Gravity
        p.rotation.x += 0.1;
        p.scale.multiplyScalar(0.9);
        if(p.scale.x < 0.05) {
            scene.remove(p);
            particles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

function setupEvents() {
    window.addEventListener('resize', () => {
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = 24;
        camera.left = frustumSize * aspect / -2;
        camera.right = frustumSize * aspect / 2;
        camera.top = frustumSize / 2;
        camera.bottom = frustumSize / -2;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Audio Init on interaction
    document.body.addEventListener('click', () => {
        if (!Audio.ctx) Audio.init();
        if (Audio.ctx && Audio.ctx.state === 'suspended') Audio.ctx.resume();
    }, { once: true });

    UI.btnRandom.addEventListener('click', () => {
        UI.seed.value = Math.floor(Math.random() * 99999);
    });

    UI.btnReset.addEventListener('click', () => {
        if (!Audio.ctx) Audio.init();
        state.seed = parseInt(UI.seed.value);
        state.difficulty = parseInt(UI.diff.value);
        state.theme = UI.theme.value;
        generateLevel();
    });

    UI.btnRecord.addEventListener('click', toggleRecording);
}

async function toggleRecording() {
    if (!Audio.ctx) Audio.init();
    
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        UI.btnRecord.textContent = "Processing...";
        UI.btnRecord.classList.remove('recording');
        UI.layer.classList.remove('hidden');
    } else {
        const stream = document.querySelector('canvas').captureStream(60);
        // Try common mimeTypes for recording
        const mimeTypes = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/mp4'
        ];
        
        let selectedMime = '';
        for (let t of mimeTypes) {
            if (MediaRecorder.isTypeSupported(t)) {
                selectedMime = t;
                break;
            }
        }

        if (!selectedMime) {
            alert('MediaRecorder not supported or no valid mimeType found.');
            return;
        }

        mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMime });
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.onstop = saveVideo;

        mediaRecorder.start();
        isRecording = true;
        UI.btnRecord.textContent = "Stop Recording";
        UI.btnRecord.classList.add('recording');
        
        // Restart level for clean take
        state.seed = parseInt(UI.seed.value); 
        generateLevel(); 
        
        UI.layer.classList.add('hidden');
    }
}

function saveVideo() {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bouncey_${state.seed}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    UI.btnRecord.textContent = "Record (Short)";
}

window.addEventListener('load', init);


