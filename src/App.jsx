import React, { useEffect, useState, useRef } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import Peer from 'peerjs';

// --- Sudoku utilities ---

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Check if placing 'val' at (r,c) is valid in board (0 = empty)
function isValidPlacement(board, r, c, val) {
  if (val === 0) return true;
  // row
  for (let j = 0; j < 9; j++) if (board[r][j] === val && j !== c) return false;
  // col
  for (let i = 0; i < 9; i++) if (board[i][c] === val && i !== r) return false;
  // box
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 3; i++) for (let j = bc; j < bc + 3; j++) if (!(i === r && j === c) && board[i][j] === val) return false;
  return true;
}

// Count number of solutions using backtracking (limit to avoid long search)
function countSolutions(board, limit = 2) {
  let solutions = 0;

  function dfs(b) {
    if (solutions >= limit) return; // stop early

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (b[r][c] === 0) {
          for (let v = 1; v <= 9; v++) {
            if (isValidPlacement(b, r, c, v)) {
              b[r][c] = v;
              dfs(b);
              b[r][c] = 0;
            }
            if (solutions >= limit) return;
          }
          return;
        }
      }
    }

    // no empty cells → one full solution found
    solutions++;
  }

  const copy = deepClone(board);
  dfs(copy);
  return solutions;
}

// Solve using backtracking (used for generator)
function solve(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        for (let v = 1; v <= 9; v++) {
          if (isValidPlacement(board, r, c, v)) {
            board[r][c] = v;
            if (solve(board)) return true;
            board[r][c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

// Is victory achieved
function isVictory(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        return false;
      }
    }
  }
  return true;
}

// Generate a full valid board
function generateFullBoard() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  const nums = [1,2,3,4,5,6,7,8,9];
  function shuffle(a){
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];
    }
  }
  // Fill diagonal boxes randomly to speed up generation
  for (let k = 0; k < 9; k += 3) {
    const boxNums = [...nums]; shuffle(boxNums);
    let idx = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) board[k + i][k + j] = boxNums[idx++];
  }
  // solve the rest
  solve(board);
  return board;
}

// Generate puzzle with guaranteed unique solution
function makePuzzle(full, difficulty) {
  const puzzle = deepClone(full);

  let removals;
  switch (difficulty) {
    case "Easy": removals = 35; break;
    case "Medium": removals = 45; break;
    case "Hard": removals = 52; break;
    case "Extreme": removals = 58; break;
    default: removals = 45;
  }

  const positions = [];
  for (let i = 0; i < 81; i++) positions.push(i);

  // random order of cell removal
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  let removed = 0;

  for (let idx = 0; idx < positions.length && removed < removals; idx++) {
    const pos = positions[idx];
    const r = Math.floor(pos / 9), c = pos % 9;

    if (puzzle[r][c] === 0) continue;

    const backup = puzzle[r][c];
    puzzle[r][c] = 0;

    // Check uniqueness: must have exactly 1 solution
    const solutions = countSolutions(puzzle, 2);

    if (solutions !== 1) {
      // revert removal
      puzzle[r][c] = backup;
    } else {
      removed++;
    }
  }

  return puzzle;
}

// --- React component ---

export default function Sudoku() {
  
  const [victoryDialogOpen, setVictoryDialogOpen] = useState(false)
	 
  // UI states
  const [screen, setScreen] = useState("menu"); // menu | game
  const [difficulty, setDifficulty] = useState("Medium");

  // Game state
  const [given, setGiven] = useState(() => Array.from({length:9},()=>Array(9).fill(0)) ); // immutable clues
  const [board, setBoard] = useState(() => Array.from({length:9},()=>Array(9).fill(0))); // current pen entries (0 empty)
  const [pencil, setPencil] = useState(() => Array.from({length:9},()=>Array(9).fill([]))); // notes as arrays of numbers
  const [selected, setSelected] = useState([0,0]);
  const [pencilMode, setPencilMode] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  
  useEffect(() => {
    if (isVictory(board)) {
	  setVictoryDialogOpen(true);
	}
  }, [board]);

  // Helpers
  function pushUndo(action) {
    setUndoStack(s => { const n = [...s, action]; if (n.length > 200) n.shift(); return n; });
  }

  function applyLocalAction(action, pushToUndo = true) {
    // action types: setCell {r,c,val,mode:'pen'|'pencil'}; eraseCell {r,c}; setFullState {given,board,pencil}
    if (action.type === 'setCell') {
      const { r, c, val, mode } = action;
      // can't change given
      if (given[r][c] !== 0) return false;
	  // validate
      if (val !== 0 && !isValidPlacement(board, r, c, val)) return false;
      if (mode === 'pen') { 
        setBoard(b => {
          const nb = deepClone(b);
          nb[r][c] = val;
          return nb;
        });
		
		action.pencil = deepClone(pencil);
        // pencil cleared when writing pen
        setPencil(p => {
          const np = deepClone(p);
		  for (let i = ~~(r / 3) * 3; i < (~~(r / 3) + 1) * 3; i++) {
		    for (let j = ~~(c / 3) * 3; j < (~~(c / 3) + 1) * 3; j++) {
			  const arr = new Set(np[i][j]);
			  if (arr.has(val)) { arr.delete(val); }
			  np[i][j] = Array.from(arr).sort((a,b)=>a-b);
			}
		  }
		  for (let i = 0; i < 9; i++) {
		    const arr = new Set(np[r][i]);
			if (arr.has(val)) { arr.delete(val); }
			np[r][i] = Array.from(arr).sort((a,b)=>a-b);
		  }
		  for (let i = 0; i < 9; i++) {
		    const arr = new Set(np[i][c]);
			if (arr.has(val)) { arr.delete(val); }
			np[i][c] = Array.from(arr).sort((a,b)=>a-b);
		  }
          np[r][c] = [];
          return np;
        });
      } else {
        // pencil mode toggles a candidate in the cell
        setPencil(p => {
          const np = deepClone(p);
          const arr = new Set(np[r][c]);
          if (arr.has(val)) { arr.delete(val); } else { arr.add(val); }
          np[r][c] = Array.from(arr).sort((a,b)=>a-b);
          return np;
        });
      }
      if (pushToUndo) pushUndo(action);
    } else if (action.type === 'erase') {
      const { r, c } = action;
      if (given[r][c] !== 0) return false;
      setBoard(b => { const nb = deepClone(b); nb[r][c] = 0; return nb; });
      setPencil(p => { const np = deepClone(p); np[r][c] = []; return np; });
      if (pushToUndo) pushUndo(action);
    } else if (action.type === 'setFullState') {
      const { given: g, board: bo, pencil: pe } = action;
      setGiven(g);
      setBoard(bo);
      setPencil(pe);
      // clear undo stack (or could keep)
      setUndoStack([]);
    }
    return true;
  }

  function undo() {
    setUndoStack(s => {
      if (s.length === 0) return s;
      const last = s[s.length - 1];
      const rest = s.slice(0, s.length - 1);
      const a = last;
      if (a.type === 'setCell') {
        if (a.mode === 'pen') {
          if (a.prev !== undefined) {
            setBoard(b => { const nb = deepClone(b); nb[a.r][a.c] = a.prev; return nb; });
            setPencil(a.pencil);
          }
        } else {
          if (a.prevPencil !== undefined) {
            setPencil(p => { const np = deepClone(p); np[a.r][a.c] = a.prevPencil; return np; });
          }
        }
      } else if (a.type === 'erase') {
        if (a.prev !== undefined) {
          setBoard(b => { const nb = deepClone(b); nb[a.r][a.c] = a.prev; return nb; });
          setPencil(p => { const np = deepClone(p); np[a.r][a.c] = a.prevPencil || []; return np; });
        }
      }
      return rest;
    });
  }

  // When creating actions, we include prev snapshots for undo/revert
  function makeSetCellAction(r,c,val,mode){
    const prev = board[r][c];
    const prevPencil = pencil[r][c];
    return { type: 'setCell', r, c, val, mode, prev, prevPencil };
  }
  function makeEraseAction(r,c){
    const prev = board[r][c];
    const prevPencil = pencil[r][c];
    return { type: 'erase', r, c, prev, prevPencil };
  }

  // Game start
  function startGame(selectedDifficulty) {
    const full = generateFullBoard();
    const puzz = makePuzzle(full, selectedDifficulty);
    // set given, board, pencil reset
    const giv = deepClone(puzz);
    const bo = deepClone(puzz);
    // zeros remain as 0
    setGiven(giv);
    setBoard(bo);
    setPencil(Array.from({length:9},()=>Array.from({length:9},()=>[])));
    setUndoStack([]);
    setDifficulty(selectedDifficulty);
    setScreen('sudoku');
	setPencilMode(false);
  }

  // Cell click handler
  function onCellClick(r,c) {
    setSelected([r,c]);
  }

  // Input a number (button press)
  function inputNumber(n) {
    const [r,c] = selected;
    if (given[r][c] !== 0) return;
    if (pencilMode) {
      const action = makeSetCellAction(r,c,n,'pencil');
      applyLocalAction(action, true);
    } else {
      // validate against current board (without this cell)
      const valid = isValidPlacement(board, r, c, n);
      if (!valid) {
        // invalid placement — do nothing
        return;
      }
      const action = makeSetCellAction(r,c,n,'pen');
      applyLocalAction(action, true);
    }
  }

  function onErase() {
    const [r,c] = selected;
    if (given[r][c] !== 0) return;
    const action = makeEraseAction(r,c);
    applyLocalAction(action, true);
  }

  // --- Domino state & PeerJS ---
  const [dominoVisible, setDominoVisible] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const peerRef = useRef(null);
  const connsRef = useRef([]); // data connections to clients (for host) or to host (for client)
  const [peerId, setPeerId] = useState(null);
  const [roomId, setRoomId] = useState(''); // host id
  const [players, setPlayers] = useState([]); // {id, name, peerId}
  const localPlayerRef = useRef({id: null, name: 'You', peerId: null, slot: 0});
  const [roomLog, setRoomLog] = useState([]);
  const [name, setName] = useState('');
  const [hostId, setHostId] = useState('');
  
  useEffect(() => {
    if (name) {
	  if (isHost) {
	    hostListener();
	  } else {
		if (hostId) {
		  clientListener();
		}
	  }
    }
  }, [name, isHost, hostId]);

  // Game state (host authoritative)
  const [dominoState, setDominoState] = useState({ // broadcasted full state
    running: false,
    tilesOnBoard: [], // array of tile arrays, e.g. [[6,6],[6,5],...]
    ends: null, // [leftVal, rightVal]
    hands: {}, // peerId -> [[a,b],...]
    boneyardCount: 0,
    turnOrder: [], // array of peerIds in order
    currentTurnIndex: 0,
    winner: null,
  });

  // UI selections for playing
  const [selectedTileIndex, setSelectedTileIndex] = useState(null);

  // Helpers to append to log
  function pushLog(msg) { setRoomLog(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]); }

  // Create Peer (common)
  function createPeer(name = 'Player') {
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch(e){}
      peerRef.current = null;
      connsRef.current = [];
      setPlayers([]);
      setPeerId(null);
      setRoomId('');
      setIsHost(false);
    }
    const peer = new Peer();
    peerRef.current = peer;
    peer.on('open', id => {
      setPeerId(id);
      localPlayerRef.current.peerId = id;
      localPlayerRef.current.name = name || 'Player';
      pushLog(`Peer created: ${id}`);
    });
    peer.on('error', err => { pushLog('Peer error: ' + (err && err.message)); });
    return peer;
  }
  
  function hostListener() {
	const peer = createPeer(name);
	peer.on('connection', conn => {
      // incoming connection from a client
      conn.on('open', () => {
        // accept up to 3 remote + host = 4 total
        if (connsRef.current.length >= 3) {
          conn.send({ type: 'full' });
          conn.close();
          pushLog('Rejected connection (room full)');
          return;
        }
        connsRef.current.push(conn);
        pushLog('Client connected: ' + conn.peer);
        // listen messages
        conn.on('data', d => handleClientMessage(conn, d));
        conn.on('close', () => {
          connsRef.current = connsRef.current.filter(x => x !== conn);
          setPlayers(ps => ps.filter(p => p.peerId !== conn.peer));
          pushLog('Client disconnected: ' + conn.peer);
        });
        // request name/hello
        conn.send({ type: 'welcome_request' });
      });
	  
	  setRoomId(peerRef.current ? peerRef.current.id : '');
      // host is also a player
      localPlayerRef.current.peerId = peerRef.current.id;
      localPlayerRef.current.id = peerRef.current.id;
      localPlayerRef.current.name = name;
      setPlayers([{ id: peerRef.current.id, name, peerId: peerRef.current.id }]);
      pushLog('Room created. Room ID (share this with friends to join): ' + (peerRef.current && peerRef.current.id));
    });
  }

  // Host: create room
  function createRoom(nameInput = 'Host') {
    setName(nameInput);
    setIsHost(true);
  }

  // Host message handler for client messages
  function handleClientMessage(conn, data) {
    const peer = conn.peer;
    if (!data || !data.type) return;
    if (data.type === 'introduce') {
      // client tells name
      const name = data.name || ('Player-' + peer.slice(0,4));
      setPlayers(ps => { const n = [...ps, { id: peer, name, peerId: peer }]; return n; });
      pushLog(`${name} joined (${peer})`);
      // send initial players list
      broadcastToAll({ type: 'players_update', players: [...players.map(p=>({id:p.id,name:p.name,peerId:p.peerId})), { id: peer, name, peer } ]});
    } else if (data.type === 'action') {
      // play tile or draw or pass - host validates and applies
      if (!isHost) return;
      const action = data.action;
      processPlayerAction(peer, action);
    }
  }
  
  function clientListener() {
	const peer = createPeer(name);
    peer.on('open', () => {
      const conn = peer.connect(hostId);
      conn.on('open', () => {
        connsRef.current = [conn];
        pushLog('Connected to host: ' + hostId);
        setRoomId(hostId);
        // send name introduction
        conn.send({ type: 'introduce', name });
        // listen messages
        conn.on('data', d => handleHostMessage(d));
        conn.on('close', () => {
          pushLog('Disconnected from host');
          connsRef.current = [];
          setPlayers([]);
        });
      });
      conn.on('error', err => pushLog('Conn error: '+ (err && err.message)));
    });
  }

  // Client: join room (provide hostId and name)
  function joinRoom(hostId, nameInput='Player') {
	setName(nameInput);
	setHostId(hostId);
	setIsHost(false);
  }

  function handleHostMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'full') { pushLog('Host says: room full'); }
    else if (data.type === 'players_update') { setPlayers(data.players); }
    else if (data.type === 'state') { setDominoState(data.state); }
    else if (data.type === 'log') { pushLog(data.msg); }
    else if (data.type === 'start_ack') { pushLog('Game started'); }
  }

  // Broadcast to all clients (host-only) including updating host UI
  function broadcastToAll(msg) {
    // to clients
    connsRef.current.forEach(conn => { try { conn.send(msg); } catch(e){} });
    // also reflect on host UI by calling handleHostMessage if needed
    if (msg.type === 'state') setDominoState(msg.state);
  }

  // Host: start game
  function hostStartGame() {
    if (!isHost || !peerRef.current) return;
    const allPlayers = [{ id: peerRef.current.id, name: localPlayerRef.current.name, peerId: peerRef.current.id }, ...(players.filter(p=>p.peerId!==peerRef.current.id))];
    if (allPlayers.length < 2) { pushLog('Need at least 2 players to start'); return; }
    // prepare tiles and deal
    const tiles = makeDoubleSixSet(); 
	shuffleArray(tiles);
    const hands = {};
    const playerIds = allPlayers.map(p=>p.peerId);
    const handSize = playerIds.length === 2 ? 7 : 5; // common rule: 7 tiles for 2 players, else 5
    let idx = 0;
    for (const pid of playerIds) {
      hands[pid] = tiles.slice(idx, idx + handSize);
      idx += handSize;
    }
    const boneyard = tiles.slice(idx);
    const first = null;
    const state = {
      running: true,
      tilesOnBoard: [],
      ends: null,
      hands,
      boneyardCount: boneyard.length,
      boneyardTiles: boneyard, // host keeps full boneyard
      turnOrder: playerIds,
      currentTurnIndex: 0,
      winner: null,
    };
    setDominoState(state);
    broadcastToAll({ type: 'state', state });
    broadcastToAll({ type: 'log', msg: 'Host started the game' });
  }

  // Host processes action from a player: action types: play {tileIndex, tile}, draw, pass
  function processPlayerAction(peerIdActing, action) {
    if (!isHost) return;
    setDominoState(prev => {
      const state = deepClone(prev);
      if (!state.running) return state;
      const currentPeer = state.turnOrder[state.currentTurnIndex];
      if (peerIdActing !== currentPeer) {
        // not this player's turn
        pushLog(`Ignored action from ${peerIdActing}: not your turn`);
        return state;
      }
      const hand = state.hands[peerIdActing] || [];
      if (action.type === 'play') {
        const tile = action.tile; // [a,b]
        // validate tile present in hand
        const idxInHand = hand.findIndex(t => t[0]===tile[0] && t[1]===tile[1]);
        if (idxInHand === -1) { pushLog('Invalid play: tile not in hand'); return state; }
        // validate placement against ends
        if (state.tilesOnBoard.length === 0) {
          // first tile
          state.tilesOnBoard.push(tile);
          state.ends = [tile[0], tile[1]];
        } else {
          const left = state.ends[0]; const right = state.ends[1];
          const fitsLeft = (tile[0] === left || tile[1] === left);
          const fitsRight = (tile[0] === right || tile[1] === right);
          if (!fitsLeft && !fitsRight) { pushLog('Tile does not fit on either end'); return state; }
          // prefer player's chosen end if provided
          const placeAt = action.side || (fitsLeft ? 'left' : 'right');
          if (placeAt === 'left') {
            // orient tile so that matching value is adjacent
            const val = left;
            const newLeft = (tile[0] === val) ? tile[1] : tile[0];
            state.tilesOnBoard.unshift(tile);
            state.ends[0] = newLeft;
          } else {
            const val = right;
            const newRight = (tile[0] === val) ? tile[1] : tile[0];
            state.tilesOnBoard.push(tile);
            state.ends[1] = newRight;
          }
        }
        // remove tile from hand
        state.hands[peerIdActing].splice(idxInHand,1);
        // check win
        if (state.hands[peerIdActing].length === 0) { state.running = false; state.winner = peerIdActing; pushLog(`Player ${peerIdActing} wins!`); }
        // advance turn
        state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
      } else if (action.type === 'draw') {
        if (state.boneyardTiles && state.boneyardTiles.length > 0) {
          const tile = state.boneyardTiles.pop();
          state.hands[peerIdActing].push(tile);
          state.boneyardCount = state.boneyardTiles.length;
          // after drawing, player's turn often ends (rules vary). We'll let player end turn after draw.
          state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
        } else {
          // nothing to draw, pass
          state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
        }
      } else if (action.type === 'pass') {
        state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
      }
      // broadcast new state
      broadcastToAll({ type: 'state', state });
      return state;
    });
  }

  // Client sends an action to host
  function clientSendAction(action) {
    if (isHost) { processPlayerAction(peerRef.current.id, action); return; }
    const conn = connsRef.current[0]; if (!conn) { pushLog('Not connected to host'); return; }
    conn.send({ type: 'action', action });
  }

  // Local UI actions for playing a tile (clicking one of player's tiles)
  function playTileUI(tile, side) {
    // find our peerId
    const pid = peerId;
    clientSendAction({ type: 'play', tile, side });
  }
  function drawUI() { clientSendAction({ type: 'draw' }); }
  function passUI() { clientSendAction({ type: 'pass' }); }

  // Cleanup on unmount
  useEffect(() => {
    return () => { try { peerRef.current && peerRef.current.destroy(); } catch(e){} };
  }, []);

  // --- Domino UI ---
  function DominoArea() {
    return (
      <div className="bg-white p-4 rounded shadow mt-6">
        <h2 className="text-2xl font-semibold mb-3">Domino</h2>
		  <div>
            <div className="flex gap-3 mb-3 flex-wrap">
              <div className="p-2 border rounded">
                <div className="text-xs text-gray-500">Your Peer ID</div>
                <div className="font-mono text-sm">{peerId || '—'}</div>
              </div>
              <div className="p-2 border rounded">
                <div className="text-xs text-gray-500">Room (host) ID</div>
                <div className="font-mono text-sm">{roomId || '—'}</div>
              </div>
              <div className="p-2">
                <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={() => createRoom(prompt('Your display name (host):','Host') || 'Host')}>Create room (host)</button>
              </div>
              <div className="p-2">
                <input className="border px-2 py-1" placeholder="Host ID to join" id="joinHostId" />
                <button className="px-3 py-1 ml-2 bg-blue-600 text-white rounded" onClick={() => {
                  const hostId = (document.getElementById('joinHostId')?.value || '').trim(); if (!hostId) return alert('Enter host id'); joinRoom(hostId, prompt('Your display name','Player') || 'Player');
                }}>Join room</button>
              </div>
              <div className="p-2">
                <button className="px-3 py-1 bg-yellow-500 rounded" onClick={() => { if (!isHost) return alert('Only host can start'); hostStartGame(); }}>Start game (host)</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-2 border rounded">
                <div className="font-semibold">Players</div>
                <ul>
                  {players.map(p => (<li key={p.peerId} className="py-1">{p.name} <span className="font-mono text-xs text-gray-500">({p.peerId ? p.peerId.slice(0,6) : '-'})</span></li>))}
                </ul>
              </div>

              <div className="p-2 border rounded col-span-2">
                <div className="font-semibold">Game</div>
                {!dominoState.running ? (<div className="py-2 text-sm text-gray-600">Game not running</div>) : (
                  <div>
                    <div className="py-2">Board: {dominoState.tilesOnBoard.map((t,i)=> <span key={i} className="inline-block px-2 py-1 mx-1 border rounded">{tileToStr(t)}</span>)}</div>
                    <div className="py-2">Ends: {dominoState.ends ? `${dominoState.ends[0]} / ${dominoState.ends[1]}` : '—'}</div>
                    <div className="py-2">Boneyard: {dominoState.boneyardCount}</div>
                    <div className="py-2">Turn: {dominoState.turnOrder && dominoState.turnOrder.length>0 ? (dominoState.turnOrder[dominoState.currentTurnIndex] === peerId ? 'Your turn' : `Player ${dominoState.turnOrder[dominoState.currentTurnIndex].slice(0,6)}`) : '—'}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-2 border rounded">
                <div className="font-semibold">Your hand</div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(dominoState.hands && dominoState.hands[peerId] ? dominoState.hands[peerId] : []).map((t, idx) => (
                    <button key={idx} className="px-2 py-1 border rounded" onClick={() => setSelectedTileIndex(idx)} style={{background: selectedTileIndex===idx? '#e6f7ff' : undefined}}>{tileToStr(t)}</button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => {
                    const sel = selectedTileIndex; if (sel===null) return alert('Select a tile'); const myHand = dominoState.hands && dominoState.hands[peerId] ? dominoState.hands[peerId] : []; const tile = myHand[sel]; // try left first
                    playTileUI(tile, null);
                  }}>Play selected</button>
                  <button className="px-3 py-1 bg-gray-200 rounded" onClick={() => drawUI()}>Draw</button>
                  <button className="px-3 py-1 bg-gray-200 rounded" onClick={() => passUI()}>Pass</button>
                </div>
              </div>

              <div className="p-2 border rounded">
                <div className="font-semibold">Log</div>
                <div style={{maxHeight: '180px', overflowY: 'auto'}} className="mt-2 text-xs font-mono">
                  {roomLog.map((l,i)=> <div key={i}>{l}</div>)}
                </div>
              </div>
            </div>
          </div>      
	    </div>
    );
  }

  // --- Main render ---
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <div className="max-w-4xl w-full">
        {screen === 'menu' && (
		  <React.Fragment>
            <div className="bg-white p-6 mb-6 rounded shadow">
              <h1 className="text-4xl text-center font-bold mb-6">Sudoku</h1>
              <div className="flex justify-center gap-3 mb-6">
                <button className="px-4 py-2 cursor-pointer bg-blue-600 hover:bg-blue-400 text-white rounded" onClick={() => { setScreen('sudokuDifficulty'); }}>Start</button>
                <button className="px-4 py-2 cursor-pointer bg-red-500 hover:bg-red-300 text-white rounded" onClick={() => window.close?.() || alert('Exit — close the tab') }>Exit</button>
              </div>
            </div>
		    <div className="bg-white p-6 rounded shadow">
              <h1 className="text-4xl text-center font-bold mb-6">Domino</h1>
              <div className="flex justify-center gap-3 mb-6">
                <button className="px-4 py-2 cursor-pointer bg-blue-600 hover:bg-blue-400 text-white rounded" onClick={() => { setScreen('domino'); }}>Start</button>
                <button className="px-4 py-2 cursor-pointer bg-red-500 hover:bg-red-300 text-white rounded" onClick={() => window.close?.() || alert('Exit — close the tab') }>Exit</button>
              </div>
            </div>
		  </React.Fragment>
        )}

        {screen === 'sudokuDifficulty' && (
          <div className="bg-white p-6 rounded shadow">
            <h2 className="text-4xl text-center font-semibold mb-6">Select difficulty</h2>
            <div className="flex flex-col md:flex-row flex-wrap content-center justify-center gap-3 mb-6">
              {['Easy','Medium','Hard','Extreme'].map(d => (
                <button key={d} className={`px-4 py-2 rounded cursor-pointer ${difficulty===d? 'bg-green-600 text-white' : 'bg-gray-200'}`} onClick={() => setDifficulty(d)}>{d}</button>
              ))}
            </div>
            <div className="flex justify-center gap-3">
              <button className="px-4 py-2 cursor-pointer bg-blue-600 hover:bg-blue-400 text-white rounded" onClick={() => startGame(difficulty)}>Play</button>
              <button className="px-4 py-2 cursor-pointer bg-gray-200 hover:bg-gray-300 rounded" onClick={() => setScreen('menu')}>Back</button>
            </div>
          </div>
        )}

        {screen === 'sudoku' && (
          <div className="bg-white p-4 rounded shadow gap-4">
            <div className="flex justify-center">
              <div className="grid grid-cols-9 auto-rows-fr gap-0 border-2 border-black" style={{width: 'min(540px, 100%)', aspectRatio: '1/1' }}>
                {range(9).map(r => range(9).map(c => {
                  const isGiven = given[r][c] !== 0;
                  const selVal = board[selected[0]][selected[1]] !== 0 ? board[selected[0]][selected[1]] : null;
                  const sameRow = r === selected[0];
                  const sameCol = c === selected[1];
                  const sameSquare = (~~(r / 3) == ~~(selected[0] / 3)) && (~~(c / 3) === ~~(selected[1] / 3));
                  const isSelected = sameRow && sameCol;
                  const val = board[r][c];
                  const notes = pencil[r][c] || [];
                  const sameVal = selVal && (val === selVal || notes.includes(selVal));
                  const highlight = selVal && (sameRow || sameCol || sameSquare);
                  let bgClass = 'bg-white'; if (isSelected || sameVal) bgClass = 'bg-blue-100'; else if (highlight) bgClass = 'bg-gray-200';
                  return (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => onCellClick(r,c)}
                      className={`relative w-full h-full flex items-center justify-center cursor-pointer select-none ${bgClass} border ${((c+1)%3===0 && c!==8) ? 'border-r-2' : ''} ${((r+1)%3===0 && r!==8) ? 'border-b-2' : ''}`}
                    >
                      {isGiven ? (
                        <div className="text-2xl md:text-3xl font-bold">{given[r][c]}</div>
                      ) : (
                        <>
                          {val !== 0 ? (
                            <div className="text-2xl md:text-3xl text-sky-700 font-bold">{val}</div>
                          ) : (
                            notes.length > 0 ? (
                              <div className="absolute text-tiny md:text-xs grid grid-cols-3 auto-rows-fr w-full h-full p-1">
                                {range(9).map(i => (
                                  <div key={i} className="relative w-full h-full flex items-center justify-center leading-3 p-1">{notes.includes(i+1) ? i+1 : ' '}</div>
                                ))}
                              </div>
                            ) : ''
                          )}
                        </>
                      )}
                    </div>
                  );
                }))}
              </div>
            </div>
            <div className="flex justify-center gap-2 mt-3">
              <div className="bg-gray-50 p-3 rounded">
                <div className="grid grid-cols-9 gap-2" style={{width: 'min(480px, 80vw)', aspectRatio: '10/1' }}>
                  {range(9).map(i => (
                    <button key={i} className="relative w-full h-full flex items-center justify-center cursor-pointer text-xl md:text-2xl select-none bg-gray-200 hover:bg-gray-300 rounded" onClick={() => inputNumber(i+1)}>{i+1}</button>
                  ))}
                </div>
              </div>
            </div>
              <div className="flex justify-center gap-2 mt-3">
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { setPencilMode(m=>!m); }}>{pencilMode ? 'Pencil: ON' : 'Pencil: OFF'}</button>
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => undo()}>Undo</button>
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => onErase()}>Erase</button>
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { setScreen('menu'); }}>Exit to Menu</button>
              </div>
          </div>
        )}
		
		{screen === 'domino' && <DominoArea />}
      </div>
      <Dialog open={victoryDialogOpen} onClose={setVictoryDialogOpen} className="relative z-10">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-gray-500/75 transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in dark:bg-gray-900/50"
        />

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
            <DialogPanel
              transition
              className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in sm:my-8 sm:w-full max-w-lg sm:max-w-2xs data-closed:sm:translate-y-0 data-closed:sm:scale-95 dark:bg-gray-800 dark:outline dark:-outline-offset-1 dark:outline-white/10"
            >
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 dark:bg-gray-800">
                <h1 className="text-4xl lg:text-5xl text-center font-bold mb-10">Victory!</h1>
                <div className="flex justify-center gap-2 mt-3">
                  <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { startGame(difficulty); setVictoryDialogOpen(false); }}>Play Again</button>
                  <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { setScreen('menu'); setVictoryDialogOpen(false); }}>Exit to Menu</button>
                </div>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </div>
  );
}