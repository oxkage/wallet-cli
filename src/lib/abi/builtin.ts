/**
 * Bundled human-readable ABI strings for common token standards.
 *
 * The contract-call op (and the erc20-transfer/erc20-approve ops) build
 * ethers Interface objects from these strings via the JSON human-readable
 * ABI parser. We keep them as strings (not TS arrays) so they can be
 * loaded by `new ethers.Interface(...)` and so users can pass the same
 * string format in plan JSON for inline ABIs.
 */

export const ERC20_ABI = `[
  {"type":"function","name":"name","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"totalSupply","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address","name":"account"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"allowance","stateMutability":"view","inputs":[{"type":"address","name":"owner"},{"type":"address","name":"spender"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"transfer","stateMutability":"nonpayable","inputs":[{"type":"address","name":"to"},{"type":"uint256","name":"amount"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"type":"address","name":"spender"},{"type":"uint256","name":"amount"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"transferFrom","stateMutability":"nonpayable","inputs":[{"type":"address","name":"from"},{"type":"address","name":"to"},{"type":"uint256","name":"amount"}],"outputs":[{"type":"bool"}]},
  {"type":"event","name":"Transfer","inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"anonymous":false},
  {"type":"event","name":"Approval","inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"anonymous":false}
]`;

export const ERC721_ABI = `[
  {"type":"function","name":"name","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address","name":"owner"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"ownerOf","stateMutability":"view","inputs":[{"type":"uint256","name":"tokenId"}],"outputs":[{"type":"address"}]},
  {"type":"function","name":"safeTransferFrom","stateMutability":"nonpayable","inputs":[{"type":"address","name":"from"},{"type":"address","name":"to"},{"type":"uint256","name":"tokenId"}],"outputs":[]},
  {"type":"function","name":"transferFrom","stateMutability":"nonpayable","inputs":[{"type":"address","name":"from"},{"type":"address","name":"to"},{"type":"uint256","name":"tokenId"}],"outputs":[]},
  {"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"type":"address","name":"to"},{"type":"uint256","name":"tokenId"}],"outputs":[]},
  {"type":"function","name":"setApprovalForAll","stateMutability":"nonpayable","inputs":[{"type":"address","name":"operator"},{"type":"bool","name":"approved"}],"outputs":[]},
  {"type":"function","name":"getApproved","stateMutability":"view","inputs":[{"type":"uint256","name":"tokenId"}],"outputs":[{"type":"address"}]},
  {"type":"function","name":"isApprovedForAll","stateMutability":"view","inputs":[{"type":"address","name":"owner"},{"type":"address","name":"operator"}],"outputs":[{"type":"bool"}]},
  {"type":"event","name":"Transfer","inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":true,"name":"tokenId","type":"uint256"}],"anonymous":false},
  {"type":"event","name":"Approval","inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"approved","type":"address"},{"indexed":true,"name":"tokenId","type":"uint256"}],"anonymous":false},
  {"type":"event","name":"ApprovalForAll","inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"operator","type":"address"},{"indexed":false,"name":"approved","type":"bool"}],"anonymous":false}
]`;

export const PERMIT2_ABI = `[
  {"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"type":"address","name":"token"},{"type":"address","name":"spender"},{"type":"uint160","name":"amount"},{"type":"uint48","name":"expiration"}],"outputs":[]},
  {"type":"function","name":"permit","stateMutability":"nonpayable","inputs":[{"type":"address","name":"owner"},{"type":"tuple","name":"permitSingle","components":[{"type":"address","name":"details"},{"type":"address","name":"spender"},{"type":"uint160","name":"sigDeadline"},{"type":"uint48","name":"nonce"}]},{"type":"bytes","name":"signature"}],"outputs":[]},
  {"type":"function","name":"transferFrom","stateMutability":"nonpayable","inputs":[{"type":"address","name":"from"},{"type":"address","name":"to"},{"type":"uint160","name":"amount"},{"type":"address","name":"token"}],"outputs":[{"type":"uint160","name":"transferred"}]},
  {"type":"function","name":"allowance","stateMutability":"view","inputs":[{"type":"address","name":"owner"},{"type":"address","name":"token"},{"type":"address","name":"spender"}],"outputs":[{"type":"uint160","name":"amount"},{"type":"uint48","name":"expiration"},{"type":"uint48","name":"nonce"}]}
]`;

export const BUILTIN_ABIS: Record<string, string> = {
  erc20: ERC20_ABI,
  erc721: ERC721_ABI,
  permit2: PERMIT2_ABI,
};
