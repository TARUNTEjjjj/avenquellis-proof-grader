set(stage "${BUILD_DIR}/installed-consumer-check")
file(REMOVE_RECURSE "${stage}")
function(check_command)
    execute_process(COMMAND ${ARGV} COMMAND_ERROR_IS_FATAL ANY)
endfunction()
# Name a configuration only when there is one: ${ARGV} drops an empty --config value.
set(config_args)
set(config_output)
if(NOT CONFIG STREQUAL "")
    set(config_args --config "${CONFIG}")
    set(config_output "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_${CONFIG_UPPER}=${stage}/bin")
endif()
check_command("${CMAKE_COMMAND}" --install "${BUILD_DIR}" ${config_args} --prefix "${stage}/prefix")
check_command("${CMAKE_COMMAND}" -S "${SOURCE_DIR}/native-tests/consumer" -B "${stage}/project"
    "-DCMAKE_CXX_COMPILER=${COMPILER}" "-DCMAKE_BUILD_TYPE=${CONFIG}" "-DCMAKE_PREFIX_PATH=${stage}/prefix"
    "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${stage}/bin" ${config_output})
check_command("${CMAKE_COMMAND}" --build "${stage}/project" ${config_args})
check_command("${stage}/bin/grader-consumer${EXE_SUFFIX}")
