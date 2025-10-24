// Constante que define o tempo de cada segmento (60 segundos)
const SEGMENTO_TEMPO = 60;

// Configurações de versão e URLs da CDN (Usando Single-Thread para compatibilidade)
const CORE_VERSION = '0.12.7';
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core-st@${CORE_VERSION}/dist`; // ST = Single Thread
const CORE_JS_URL = `${CORE_BASE_URL}/ffmpeg-core.js`;

// Verifica se as classes foram importadas (garantia de que o index.html rodou)
if (!window.FFmpeg || !window.toBlobURL) {
    console.error("ERRO FATAL: Falha na importação do módulo no index.html. Verifique a aba Rede (Network) do F12.");
    throw new Error("FFmpeg não definido. Falha na inicialização.");
}

const ffmpeg = new window.FFmpeg();

// Referências dos elementos do HTML
const inputElement = document.getElementById('video-input');
const cutButton = document.getElementById('cut-button');
const progressArea = document.getElementById('progress-area');
const statusMessage = document.getElementById('status-message');
const progressBar = document.getElementById('progress-bar');
const downloadArea = document.getElementById('download-area');
const clipList = document.getElementById('clip-list');
const errorArea = document.getElementById('error-area');
const errorMessage = document.getElementById('error-message');


/**
 * Funções de UI
 */
function updateUI(status, message, progress = 0) {
    statusMessage.textContent = message;
    progressBar.value = progress;
    
    // Esconde todas as áreas de status por padrão
    progressArea.classList.add('hidden');
    downloadArea.classList.add('hidden');
    errorArea.classList.add('hidden');
    
    if (status === 'loading' || status === 'ready') {
        progressArea.classList.remove('hidden');
    } else if (status === 'error') {
        errorArea.classList.remove('hidden');
        errorMessage.textContent = message;
    } else if (status === 'done') {
        downloadArea.classList.remove('hidden');
    }
}

/**
 * 1. Inicializa o FFmpeg.wasm
 */
async function loadFFmpeg() {
    updateUI('loading', 'Aguarde, carregando o motor de corte (Versão de Compatibilidade)...');
    
    // Configura o log para ver o que o FFmpeg está fazendo no console
    ffmpeg.on('log', ({ message }) => {
        // console.log(`[FFmpeg LOG] ${message}`); 
    });
    
    // Configura a barra de progresso
    ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.floor(progress * 100);
        updateUI('loading', `Processando corte: ${percent}%`, percent);
    });

    try {
        // Cria as URLs de Blob para o Core JS e WASM
        const coreURL = await window.toBlobURL(CORE_JS_URL, 'text/javascript');
        const wasmURL = await window.toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
        
        console.log("Iniciando carregamento. Verifique a aba Rede (F12) se falhar.");

        await ffmpeg.load({
            coreURL: coreURL,
            wasmURL: wasmURL,
            // Não passamos workerURL.
        });
        
        // SUCESSO: Habilita o botão
        cutButton.disabled = false;
        updateUI('ready', 'Pronto! Selecione o vídeo e clique em "Iniciar Corte".', 100);
        console.log("FFmpeg (Single Thread) carregado com sucesso. Botão habilitado.");
        
    } catch (e) {
        // FALHA: Reporta o erro no console e na tela
        console.error("ERRO CRÍTICO NA INICIALIZAÇÃO DO FFmpeg:", e);
        cutButton.disabled = true; 
        updateUI('error', 
            `Falha ao carregar o motor de corte. Motivo: ${e.message}.
            Acesse o Console (F12) e a aba Rede (Network) para ver qual arquivo falhou ao ser baixado.`
        );
    }
}

/**
 * Função auxiliar para obter a duração do vídeo
 */
function getVideoDuration(file) {
    return new Promise((resolve, reject) => {
        const videoElement = document.createElement('video');
        videoElement.preload = 'metadata';
        
        videoElement.onloadedmetadata = function() {
            window.URL.revokeObjectURL(videoElement.src);
            resolve(videoElement.duration);
        };
        
        videoElement.onerror = function() {
            reject(new Error("Não foi possível ler a duração do vídeo."));
        };

        videoElement.src = URL.createObjectURL(file);
    });
}


/**
 * 3. A Função de Corte Principal
 */
async function cutVideo() {
    const file = inputElement.files[0];
    if (!file || cutButton.disabled) return;

    try {
        clipList.innerHTML = '';
        updateUI('loading', 'Lendo a duração do vídeo...');
        cutButton.disabled = true;
        
        const duration = await getVideoDuration(file);
        
        // --- 1. Calcular os comandos de corte ---
        const numClipes = Math.ceil(duration / SEGMENTO_TEMPO);
        const segmentTimes = [];
        
        // Gera a lista de tempos para o comando -segment_times (60, 120, 180...)
        for (let i = 0; i < numClipes - 1; i++) {
            segmentTimes.push(Math.round((i + 1) * SEGMENTO_TEMPO)); 
        }
        
        const segmentListString = segmentTimes.join(',');
        const outputFilename = 'clipe_%03d.mp4'; 
        
        // Comando FFmpeg com -c copy (corte rápido)
        const command = [
            '-i', 'input.mp4',
            '-c', 'copy', 
            '-map', '0', 
            '-f', 'segment',
            '-segment_times', segmentListString,
            '-reset_timestamps', '1',
            outputFilename
        ];
        
        console.log(`Segmentação: Duração ${duration.toFixed(2)}s. Segmentos em: ${segmentListString || 'N/A'}. Total de clipes: ${numClipes}`);

        // --- 2. Escrever o arquivo na memória do FFmpeg (FS) ---
        updateUI('loading', `Carregando vídeo para a memória...`);
        const data = new Uint8Array(await file.arrayBuffer());
        await ffmpeg.writeFile('input.mp4', data);


        // --- 3. Executar o corte ---
        updateUI('loading', `Iniciando corte de ${numClipes} clipes...`);
        await ffmpeg.exec(command);
        
        
        // --- 4. Ler e disponibilizar os arquivos de saída ---
        updateUI('loading', 'Criando links de download...');
        for (let i = 0; i < numClipes; i++) {
            // O nome do clipe começa com 001, 002, etc.
            const clipName = `clipe_${String(i + 1).padStart(3, '0')}.mp4`;
            
            try {
                // Lê o arquivo gerado
                const clipData = await ffmpeg.readFile(clipName);
                
                // Cria o link de download
                const blob = new Blob([clipData], { type: 'video/mp4' });
                const url = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.href = url;
                link.download = `cortado_${SEGMENTO_TEMPO}s_${clipName}`;
                link.textContent = `⬇️ Baixar ${clipName}`;
                link.classList.add('download-link');
                clipList.appendChild(link);
            } catch (readError) {
                console.warn(`Aviso: Arquivo ${clipName} não encontrado.`, readError);
            }
        }
        
        updateUI('done');
        
    } catch (e) {
        console.error("ERRO durante o processo de corte:", e);
        updateUI('error', `Erro ao processar o vídeo. Detalhe: ${e.message}`);
    } finally {
        cutButton.disabled = false;
        await ffmpeg.deleteFile('input.mp4').catch(e => console.warn("Falha ao limpar a memória: ", e));
    }
}

// 4. Listeners (Eventos)
inputElement.addEventListener('change', () => {
    // Habilita o botão (se o FFmpeg já estiver carregado, ou seja, se cutButton.disabled for falso)
    if (!cutButton.disabled) {
        cutButton.disabled = !inputElement.files.length;
    }
    downloadArea.classList.add('hidden');
    errorArea.classList.add('hidden');
});

cutButton.addEventListener('click', cutVideo);

// 5. Inicia o carregamento
loadFFmpeg();
              
