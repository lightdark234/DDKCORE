import { Peer } from 'shared/model/peer';
import { Block } from 'shared/model/block';
import { Transaction } from 'shared/model/transaction';
import SystemRepository from 'core/repository/system';
import BlockService from 'core/service/block';
import BlockRepository from 'core/repository/block/index';
import PeerRepository from 'core/repository/peer';
import SyncRepository, { ERROR_NOT_ENOUGH_PEERS } from 'core/repository/sync';
import { TOTAL_PERCENTAGE } from 'core/util/const';
import config from 'shared/config';
import RoundService from 'core/service/round';
import SlotService from 'core/service/slot';
import { ResponseEntity } from 'shared/model/response';

export interface ISyncService {

    sendPeers(peer: Peer, requestId): void;

    sendNewBlock(block: Block): void;

    sendUnconfirmedTransaction(trs: Transaction<any>): void;

    checkCommonBlock(lastBlock: Block): Promise<ResponseEntity<{ isExist: boolean, peer?: Peer }>>;

    requestBlocks(lastBlock: Block, peer: Peer): Promise<ResponseEntity<Array<Block>>>;

    sendBlocks(data: { height: number, limit: number }, peer: Peer, requestId: string): void;

}

export class SyncService implements ISyncService {

    consensus: boolean;

    sendPeers(peer, requestId): void {
        SyncRepository.sendPeers(peer, requestId);
    }

    sendNewBlock(block: Block): void {
        block.relay += 1;
        if (block.relay < config.CONSTANTS.TRANSFER.MAX_BLOCK_RELAY) {
            SyncRepository.sendNewBlock(block);
        }
    }

    sendUnconfirmedTransaction(trs: Transaction<any>): void {
        trs.relay += 1;
        if (trs.relay < config.CONSTANTS.TRANSFER.MAX_TRS_RELAY) {
            SyncRepository.sendUnconfirmedTransaction(trs);
        }
    }

    async checkCommonBlock(lastBlock: Block): Promise<ResponseEntity<{ isExist: boolean, peer?: Peer }>> {

        const errors: Array<string> = [];
        const filteredPeers = PeerRepository.getPeersByFilter(lastBlock.height, SystemRepository.broadhash);

        if (!filteredPeers.length) {
            return new ResponseEntity({ errors: [ERROR_NOT_ENOUGH_PEERS] });
        }

        const randomPeer = PeerRepository.getRandomPeer(filteredPeers);
        if (!randomPeer) {
            errors.push(`random peer not found`);
            return new ResponseEntity({ errors });
        }

        if (this.checkBlockConsensus(lastBlock) || lastBlock.height === 1) {

            return new ResponseEntity({ data: { isExist: true, peer: randomPeer } });

        } else {

            const minHeight = Math.min(...randomPeer.blocksIds.keys());
            if (minHeight > lastBlock.height) {
                const response = await SyncRepository.requestCommonBlocks(
                    { id: lastBlock.id, height: lastBlock.height }
                );

                if (!response.success) {
                    errors.push(`response from peer not success`);
                    errors.push(...response.errors);
                    return new ResponseEntity({ errors });
                }
                const { isExist, peer } = response.data;
                if (isExist) {
                    return new ResponseEntity({ data: { peer, isExist } });
                }
            }
        }
        return new ResponseEntity({ data: { isExist: false } });
    }

    async rollback() {
        const deleteResponse = await BlockService.deleteLastBlock();
        if (!deleteResponse.success) {
            return;
        }

        const newLastBlock = BlockRepository.getLastBlock();
        RoundService.restoreToSlot(SlotService.getSlotNumber(newLastBlock.createdAt));
    }

    async requestBlocks(lastBlock, peer): Promise<ResponseEntity<Array<Block>>> {
        return SyncRepository.requestBlocks({
            height: lastBlock.height,
            limit: config.CONSTANTS.TRANSFER.REQUEST_BLOCK_LIMIT
        }, peer);
    }

    sendBlocks(data: { height: number, limit: number }, peer, requestId): void {
        const blocks = BlockRepository.getMany(data.limit, data.height);
        SyncRepository.sendBlocks(blocks, peer, requestId);
    }

    async saveRequestedBlocks(blocks: Array<Block>): Promise<ResponseEntity<void>> {
        for (const receivedBlock of blocks) {

            RoundService.restoreToSlot(SlotService.getSlotNumber(receivedBlock.createdAt));
            const receivedBlockResponse = await BlockService.receiveBlock(receivedBlock);

            if (!receivedBlockResponse.success) {
                return new ResponseEntity({
                    errors: [
                        ...receivedBlockResponse.errors, 
                        '[Service][Sync][saveRequestedBlocks] error save requested blocks!'
                    ]
                });
            }
        }
        return new ResponseEntity();
    }

    checkCommonBlocks(block: { id: string, height: number }, peer, requestId): void {
        const isExist = BlockRepository.isExist(block.id);
        SyncRepository.sendCommonBlocksExist({ isExist }, peer, requestId);
    }

    updateHeaders(lastBlock: Block) {
        SystemRepository.setBroadhash(lastBlock);
        SystemRepository.addBlockIdInPool(lastBlock);
        SystemRepository.setHeight(lastBlock);
        SyncRepository.sendHeaders(
            SystemRepository.getHeaders()
        );
    }

    getBlockConsensus(block: Block): number {
        const peers = PeerRepository.peerList()
            .filter(peer => !PeerRepository.isBanned(peer));

        const commonPeers = peers.filter(peer => PeerRepository.checkCommonBlock(peer, block));
        if (!peers.length) {
            return 0;
        }
        return (commonPeers.length + 1) / (peers.length + 1) * TOTAL_PERCENTAGE;
    }

    checkBlockConsensus(block: Block): boolean {
        return this.getBlockConsensus(block) >= config.CORE.MIN_CONSENSUS;
    }

    getConsensus(): number {
        const peers = PeerRepository.peerList()
            .filter(peer => !PeerRepository.isBanned(peer));

        const commonPeers = peers.filter(peer => {
            return peer.broadhash === SystemRepository.broadhash;
        });
        if (!peers.length) {
            return 0;
        }
        return (commonPeers.length + 1) / (peers.length + 1) * TOTAL_PERCENTAGE;
    }

    getMyConsensus(): boolean {
        return this.getConsensus() >= config.CORE.MIN_CONSENSUS;
    }

    setConsensus(value: boolean) {
        this.consensus = value;
    }
}

export default new SyncService();
