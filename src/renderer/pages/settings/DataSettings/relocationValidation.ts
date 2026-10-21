import type { UserDataRelocationValidationReason } from '@shared/types/userDataRelocation'

/** i18n key of the toast explaining why a relocation target was rejected. */
export function relocationValidationMessageKey(reason: UserDataRelocationValidationReason): string {
  switch (reason) {
    case 'target_root':
      return 'settings.data.app_data.select_error_root_path'
    case 'same_path':
    case 'target_inside_source':
    case 'target_contains_source':
      return 'settings.data.app_data.select_error_same_path'
    case 'target_protected':
      return 'settings.data.app_data.select_error_protected_path'
    case 'target_in_use':
      return 'settings.data.app_data.select_error'
    case 'target_not_empty':
      return 'settings.data.app_data.select_not_empty_dir'
    case 'target_not_enough_space':
      return 'settings.data.storage_locations.not_enough_space'
    case 'target_parent_unwritable':
    case 'source_missing':
    case 'target_not_directory':
      return 'settings.data.app_data.select_error_write_permission'
    default:
      return 'settings.data.app_data.path_change_failed'
  }
}
